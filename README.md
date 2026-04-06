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
COGNITO_VALIDATE_AUDIENCE=true

# Hybrid auth toggle:
# true  -> accepts legacy JWT + Cognito JWT
# false -> accepts only Cognito JWT
AUTH_ALLOW_LEGACY_JWT=true
LEGACY_JWT_SECRET=hanifesmat1535

DATABASE_URL=mysql://...
PORT=4100
```
