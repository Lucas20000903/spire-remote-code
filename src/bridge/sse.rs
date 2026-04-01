use axum::{
    extract::{Query, State},
    response::sse::{Event, Sse},
};
use futures::stream::Stream;
use serde::Deserialize;
use std::sync::Arc;
use tokio_stream::wrappers::ReceiverStream;

use super::registry::BridgeRegistry;

#[derive(Deserialize)]
pub struct StreamQuery {
    pub bridge_id: String,
}

pub async fn bridge_stream(
    State(registry): State<Arc<BridgeRegistry>>,
    Query(query): Query<StreamQuery>,
) -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>> {
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, std::convert::Infallible>>(256);
    let bridge_id = query.bridge_id.clone();

    // Replay queued messages
    let queued = registry.drain_queue(&bridge_id);
    let tx_clone = tx.clone();
    tokio::spawn(async move {
        for msg in queued {
            let _ = tx_clone
                .send(Ok(Event::default().event("message").data(msg)))
                .await;
        }
    });

    // Real-time message forwarding will be connected via WsHub in Task 5

    Sse::new(ReceiverStream::new(rx)).keep_alive(axum::response::sse::KeepAlive::default())
}
