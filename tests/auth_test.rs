use claude_code_remote::auth::jwt;

#[test]
fn test_jwt_roundtrip() {
    let secret = "test-secret-key-that-is-long-enough";
    let token = jwt::create_token(1, "testuser", secret).unwrap();
    let claims = jwt::verify_token(&token, secret).unwrap();
    assert_eq!(claims.user_id, 1);
    assert_eq!(claims.username, "testuser");
}

#[test]
fn test_jwt_expired_rejected() {
    use chrono::{Duration, Utc};
    use jsonwebtoken::{encode, EncodingKey, Header};

    let secret = "test-secret-key-that-is-long-enough";
    let exp = (Utc::now() - Duration::days(1)).timestamp() as usize;
    let claims = jwt::Claims {
        user_id: 1,
        username: "testuser".to_string(),
        exp,
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .unwrap();

    let result = jwt::verify_token(&token, secret);
    assert!(result.is_err(), "expired token should be rejected");
}
