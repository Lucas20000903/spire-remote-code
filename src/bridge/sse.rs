use axum::{
    extract::{Query, State},
    response::sse::{Event, Sse},
};
use futures::stream::Stream;
use serde::Deserialize;
use tokio_stream::wrappers::ReceiverStream;

use crate::state::AppState;

#[derive(Deserialize)]
pub struct StreamQuery {
    pub bridge_id: String,
}

pub async fn bridge_stream(
    State(state): State<AppState>,
    Query(query): Query<StreamQuery>,
) -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>> {
    let (sse_tx, rx) = tokio::sync::mpsc::channel::<Result<Event, std::convert::Infallible>>(256);
    let bridge_id = query.bridge_id.clone();

    // 큐에 쌓인 메시지 replay
    let queued = state.registry.drain_queue(&bridge_id);
    let sse_tx_clone = sse_tx.clone();
    tokio::spawn(async move {
        for msg in queued {
            let _ = sse_tx_clone
                .send(Ok(Event::default().event("message").data(msg)))
                .await;
        }
    });

    // bridge_senders에 이 Bridge용 sender 등록 → 실시간 메시지 수신 가능
    let (msg_tx, mut msg_rx) = tokio::sync::mpsc::channel::<String>(256);
    state
        .bridge_senders
        .write()
        .await
        .insert(bridge_id.clone(), msg_tx);

    // msg_rx → SSE 이벤트 변환 (_event 필드로 이벤트 타입 구분)
    let bid = bridge_id.clone();
    let senders = state.bridge_senders.clone();
    tokio::spawn(async move {
        while let Some(msg) = msg_rx.recv().await {
            let (event_type, data) = extract_sse_event(&msg);
            if sse_tx
                .send(Ok(Event::default().event(&event_type).data(data)))
                .await
                .is_err()
            {
                break; // SSE 연결 끊김
            }
        }
        // SSE 끊기면 sender 제거
        senders.write().await.remove(&bid);
    });

    Sse::new(ReceiverStream::new(rx)).keep_alive(axum::response::sse::KeepAlive::default())
}

/// JSON에 `_event` 필드가 있으면 SSE 이벤트 타입으로 사용하고 data에서 제거
fn extract_sse_event(msg: &str) -> (String, String) {
    if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(msg) {
        if let Some(et) = v.get("_event").and_then(|e| e.as_str()).map(String::from) {
            v.as_object_mut().unwrap().remove("_event");
            return (et, serde_json::to_string(&v).unwrap());
        }
    }
    ("message".to_string(), msg.to_string())
}
