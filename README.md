# Auth Microservice

## Cognito Auth API (Custom Backend)

Base URL:

```bash
http://localhost:4100/api/v1/auth
```

This backend manages Cognito flows with your custom APIs:
- Sign up with `username`, `first_name`, `last_name`, `email`, `phone`, `password`
- Email verification
- Admin approval/rejection in `register_user`
- Move approved users into `app_user`
- Login with MFA challenge
- Forgot password

## 1) Sign Up

Endpoint:

```http
POST /api/v1/auth/signup
```

Request body:

```json
{
  "username": "jdoe01",
  "first_name": "John",
  "last_name": "Doe",
  "email": "john@example.com",
  "phone": "+919999999999",
  "password": "StrongPass#123"
}
```

curl:

```bash
curl -X POST "http://localhost:4100/api/v1/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"jdoe01\",\"first_name\":\"John\",\"last_name\":\"Doe\",\"email\":\"john@example.com\",\"phone\":\"+919999999999\",\"password\":\"StrongPass#123\"}"
```

Typical response:

```json
{
  "success": true,
  "message": "Sign up initiated. Please verify email with the confirmation code.",
  "data": {
    "username": "jdoe01",
    "user_sub": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "code_delivery": {
      "Destination": "j***@e***.com",
      "DeliveryMedium": "EMAIL"
    }
  }
}
```

## 2) Confirm Sign Up (Email OTP)

Endpoint:

```http
POST /api/v1/auth/signup/confirm
```

Request body:

```json
{
  "username": "jdoe01",
  "confirmation_code": "123456"
}
```

curl:

```bash
curl -X POST "http://localhost:4100/api/v1/auth/signup/confirm" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"jdoe01\",\"confirmation_code\":\"123456\"}"
```

Typical response:

```json
{
  "success": true,
  "message": "Email verified. Registration is pending admin approval.",
  "data": {
    "registration_id": 12,
    "status": "PENDING_APPROVAL"
  }
}
```

## 3) Admin Review Registration (Approve/Reject)

Endpoint:

```http
POST /api/v1/auth/registrations/:id/review
```

Approve request body:

```json
{
  "action": "APPROVE",
  "role_id": 2,
  "site_id": 10,
  "corporation_id": 1001,
  "approved_by": 1,
  "review_note": "Approved by admin"
}
```

curl (approve):

```bash
curl -X POST "http://localhost:4100/api/v1/auth/registrations/12/review" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"APPROVE\",\"role_id\":2,\"site_id\":10,\"corporation_id\":1001,\"approved_by\":1,\"review_note\":\"Approved by admin\"}"
```

Reject request body:

```json
{
  "action": "REJECT",
  "approved_by": 1,
  "review_note": "Missing required business details"
}
```

curl (reject):

```bash
curl -X POST "http://localhost:4100/api/v1/auth/registrations/12/review" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"REJECT\",\"approved_by\":1,\"review_note\":\"Missing required business details\"}"
```

## 4) Login Initiate (Username + Password)

Endpoint:

```http
POST /api/v1/auth/login/initiate
```

Request body:

```json
{
  "username": "jdoe01",
  "password": "StrongPass#123"
}
```

curl:

```bash
curl -X POST "http://localhost:4100/api/v1/auth/login/initiate" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"jdoe01\",\"password\":\"StrongPass#123\"}"
```

If MFA is required, response contains `challenge_name` and `session`:

```json
{
  "success": true,
  "message": "MFA challenge sent.",
  "data": {
    "challenge_required": true,
    "challenge_name": "EMAIL_OTP",
    "session": "<cognito-session-token>"
  }
}
```

## 5) Login Respond (Submit MFA Code)

Endpoint:

```http
POST /api/v1/auth/login/respond
```

Request body:

```json
{
  "username": "jdoe01",
  "session": "<cognito-session-token>",
  "challenge_name": "EMAIL_OTP",
  "challenge_code": "654321"
}
```

curl:

```bash
curl -X POST "http://localhost:4100/api/v1/auth/login/respond" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"jdoe01\",\"session\":\"<cognito-session-token>\",\"challenge_name\":\"EMAIL_OTP\",\"challenge_code\":\"654321\"}"
```

Typical response:

```json
{
  "success": true,
  "message": "MFA verified. Login successful.",
  "data": {
    "tokens": {
      "access_token": "<access-token>",
      "id_token": "<id-token>",
      "refresh_token": "<refresh-token>",
      "expires_in": 3600
    }
  }
}
```

## 6) Forgot Password

Endpoint:

```http
POST /api/v1/auth/forgot-password
```

Request body:

```json
{
  "username": "jdoe01"
}
```

curl:

```bash
curl -X POST "http://localhost:4100/api/v1/auth/forgot-password" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"jdoe01\"}"
```

## 7) Confirm Forgot Password

Endpoint:

```http
POST /api/v1/auth/forgot-password/confirm
```

Request body:

```json
{
  "username": "jdoe01",
  "confirmation_code": "123456",
  "new_password": "NewStrongPass#123"
}
```

curl:

```bash
curl -X POST "http://localhost:4100/api/v1/auth/forgot-password/confirm" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"jdoe01\",\"confirmation_code\":\"123456\",\"new_password\":\"NewStrongPass#123\"}"
```

## Error format

```json
{
  "success": false,
  "errorCode": "ValidationError",
  "message": "Request validation failed.",
  "details": []
}
```

## Required env variables

```env
AWS_DEFAULT_REGION=ap-south-1
COGNITO_USER_POOL_ID=ap-south-1_IpHuY1R4r
COGNITO_CLIENT_ID=4gan91cej5fd3carar5ispnoit
DATABASE_URL=mysql://...
PORT=4100
AUTH_MS_JWT_EXPIRES_IN_SEC=3600
AUTH_MS_JWT_ACTIVE_KID=authms-rs-2026-04
AUTH_MS_JWT_KEYS_JSON=[{"kid":"authms-rs-2026-04","alg":"RS256","privateKeyPem":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----","publicJwk":{"kty":"RSA","n":"...","e":"AQAB"},"enabled":true}]
```

## JWKS endpoint

Public signing keys are exposed at:

```http
GET /jwks.json
```

Response format:

```json
{
  "keys": [
    {
      "kty": "RSA",
      "kid": "authms-rs-2026-04",
      "alg": "RS256",
      "use": "sig",
      "n": "...",
      "e": "AQAB"
    }
  ]
}
```

## Key rotation

1. Add new key object to `AUTH_MS_JWT_KEYS_JSON` with `enabled=true`.
2. Keep old key(s) enabled so existing tokens continue verifying.
3. Set `AUTH_MS_JWT_ACTIVE_KID` to the new `kid` to start signing with it.
4. After old tokens expire, disable/remove old keys.

## Legacy API JWKS fetch/cache guidance

1. Fetch `GET /jwks.json` at startup and cache by `kid`.
2. Verify incoming auth-ms JWT using `alg`, `kid`, and matching JWK.
3. Cache TTL recommendation: 5-15 minutes, with background refresh.
4. On unknown `kid`, force an immediate JWKS refresh once, then retry verify.
5. Do not hardcode one key; always support multiple active keys during rotation.

## Observability Metrics And Dashboard Suggestions

Structured metric logs are emitted as `AUTH_METRIC` with these counters:

- `auth_verification_success_total`
  - labels: `auth_source`, plus `token_use` (Cognito side) or `reason=verified` (legacy side)
- `auth_verification_failure_total`
  - labels: `auth_source`, `reason`
- `user_auth_bridge_upsert_total`
  - labels: `auth_source`, `provider` (and `outcome` in legacy service helper)
- `shadow_legacy_user_created_total`
  - labels: `auth_source`, `provider`

Suggested dashboard panels:

1. Auth Success Rate By Source
   - `sum(auth_verification_success_total{auth_source="cognito"})`
   - `sum(auth_verification_success_total{auth_source="auth-ms"})`
   - `sum(auth_verification_success_total{auth_source="legacy"})`
2. Verification Failures By Reason
   - Breakdown of `auth_verification_failure_total` grouped by `auth_source, reason`
3. Bridge Upsert Throughput
   - `sum(user_auth_bridge_upsert_total)` grouped by `outcome` where available
4. Shadow Legacy User Creation Trend
   - `sum(shadow_legacy_user_created_total)` over time
5. Failure Ratio
   - `sum(auth_verification_failure_total) / (sum(auth_verification_success_total) + sum(auth_verification_failure_total))`

Suggested alerts:

1. High Auth Failure Ratio
   - Trigger if failure ratio exceeds baseline (for example >5%) for 5-10 minutes.
2. Sudden `kid_not_found` Or `jwks_fetch_failed`
   - Trigger immediately; indicates JWKS rotation/cache/connectivity issues.
3. Unexpected Spike In `shadow_legacy_user_created_total`
   - Trigger if creations exceed expected onboarding baseline.
4. Bridge Upsert Failures
   - Trigger on non-zero `user_auth_bridge_upsert_total{outcome="failed"}`.
