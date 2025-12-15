use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose, Engine};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::{env, net::SocketAddr, sync::Arc};
use chrono::Utc;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone)]
struct AppState {
    jwt_secret: Arc<String>,
}

#[derive(Deserialize)]
struct EchoRequest {
    message: Option<String>,
}

#[derive(Serialize)]
struct EchoResponse {
    message: String,
    token_status: TokenStatus,
    note: &'static str,
}

#[derive(Serialize)]
#[serde(tag = "status", content = "detail")]
enum TokenStatus {
    Missing,
    Valid { sub: String, email: Option<String> },
    Invalid(&'static str),
}

#[tokio::main]
async fn main() {
    let jwt_secret = env::var("JWT_SIGNING_KEY").unwrap_or_else(|_| "dev-secret-change-me".to_string());
    let state = AppState { jwt_secret: Arc::new(jwt_secret) };

    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/echo", post(echo))
        .with_state(state);

    let port: u16 = env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3000);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    println!("Listening on {addr}");
    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}

async fn echo(State(state): State<AppState>, headers: HeaderMap, Json(body): Json<EchoRequest>) -> impl IntoResponse {
    let auth_header = headers.get("authorization").and_then(|h| h.to_str().ok());
    let token_status = match auth_header {
        Some(value) if value.to_lowercase().starts_with("bearer ") => {
            let token = value[7..].trim();
            validate_token(token, &state.jwt_secret)
        }
        Some(_) => TokenStatus::Invalid("authorization header must be Bearer"),
        None => TokenStatus::Missing,
    };

    let response = EchoResponse {
        message: body.message.unwrap_or_else(|| "ping".to_string()),
        token_status,
        note: "This endpoint echoes payloads and validates the Worker-issued token.",
    };

    (StatusCode::OK, Json(response))
}

fn validate_token(token: &str, secret: &str) -> TokenStatus {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 2 {
        return TokenStatus::Invalid("token format must be body.signature");
    }

    let body_bytes = match general_purpose::STANDARD.decode(parts[0]) {
        Ok(bytes) => bytes,
        Err(_) => return TokenStatus::Invalid("body is not valid base64"),
    };

    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(mac) => mac,
        Err(_) => return TokenStatus::Invalid("failed to load signing key"),
    };
    mac.update(parts[0].as_bytes());

    if mac.verify_slice(&general_purpose::STANDARD.decode(parts[1]).unwrap_or_default()).is_err() {
        return TokenStatus::Invalid("signature mismatch");
    }

    let payload: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(val) => val,
        Err(_) => return TokenStatus::Invalid("payload is not valid JSON"),
    };

    let exp = payload.get("exp").and_then(|v| v.as_i64()).unwrap_or_default();
    let now = Utc::now().timestamp();
    if exp > 0 && now > exp {
        return TokenStatus::Invalid("token expired");
    }

    let sub = payload
        .get("sub")
        .and_then(|v| v.as_i64().map(|v| v.to_string()))
        .or_else(|| payload.get("sub").and_then(|v| v.as_str().map(|s| s.to_string())));

    let email = payload.get("email").and_then(|v| v.as_str()).map(|s| s.to_string());

    TokenStatus::Valid {
        sub: sub.unwrap_or_else(|| "unknown".to_string()),
        email,
    }
}
