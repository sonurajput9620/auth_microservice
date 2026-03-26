# Enhancement Implementation Guide

This document explains the new features added to enhance the authentication microservice.

## Quick Start

### 1. Environment Setup

Add these to your `.env` file:

```env
# Logging Configuration
LOG_LEVEL=debug          # Options: debug, info, warn, error
LOG_DIR=./logs           # Directory where logs will be stored
NODE_ENV=development     # Options: development, production
```

### 2. Log Files

Logs are automatically created in the configured `LOG_DIR`:
- `info-YYYY-MM-DD.log` - Information logs
- `warn-YYYY-MM-DD.log` - Warning logs
- `error-YYYY-MM-DD.log` - Error logs (always created in production)

In development mode, all logs appear in console AND error logs are saved to file.

### 3. API Response Format

All API responses now follow this standardized format:

```javascript
{
  "success": boolean,
  "statusCode": number,
  "message": string,
  "data": any | null,
  "errorCode": string | null,  // Only for errors
  "errors": array | null        // Only for validation errors
}
```

### 4. Using the Logger in Your Code

```typescript
import { Logger } from "./utils/Logger";

// Info level
Logger.info("Operation completed", { user_id: 123 });

// Warning level
Logger.warn("Unusual activity detected", { attempt_count: 5 });

// Error level (with Error object)
try {
  // ... code
} catch (err) {
  Logger.error("Operation failed", err, { retry_count: 3 });
}

// Debug level (dev only)
Logger.debug("Processing data", { item_count: 100 });

// HTTP logging
Logger.http("GET", "/api/v1/users", 200, 45); // method, path, status, duration_ms
```

### 5. Using ApiResponse in Controllers

```typescript
import { ApiResponse } from "../utils/ApiResponse";

// Success responses
ApiResponse.ok(res, "User fetched", user);
ApiResponse.created(res, "User created", newUser);

// Error responses
ApiResponse.badRequest(res, "Invalid input", [
  { field: "email", message: "Invalid format" }
]);
ApiResponse.unauthorized(res, "Invalid credentials");
ApiResponse.notFound(res, "User not found");
ApiResponse.error(res, StatusCodes.CONFLICT, "User already exists", "DuplicateUser");
```

## File Structure

```
src/
├── utils/
│   ├── ApiResponse.ts (NEW) - Response formatting
│   ├── Logger.ts (NEW) - Logging utility
│   ├── AppError.ts - Custom error class
│   └── AsyncTryCatch.ts
├── middlewares/
│   ├── GlobalErrorHandler.ts (UPDATED) - Now logs errors
│   ├── RequestResponseLoggingMiddleware.ts (NEW) - HTTP logging
│
├── controllers/
│   └── AuthController.ts (UPDATED) - Uses ApiResponse & Logger
├── services/
│   └── AuthService.ts (UPDATED) - Comprehensive logging
└── index.ts (UPDATED) - Added middleware, Logger usage
```

## Logging Best Practices

### ✅ DO

```typescript
// Log structured data
Logger.info("User logged in", { user_id: 123, ip: "192.168.1.1" });

// Log at appropriate levels
Logger.debug("Starting process");           // Development details
Logger.info("Payment processed");           // General information
Logger.warn("High memory usage");           // Warning conditions
Logger.error("Payment failed", error);      // Error conditions
```

### ❌ DON'T

```typescript
// DON'T log sensitive data
Logger.info("User login", { password: "secret123" }); // WRONG!
Logger.debug("Token: " + authToken); // WRONG!

// DON'T use console.log in production
console.log("Debug info"); // Use Logger instead

// DON'T log without context
Logger.error("Failed", error); // Missing context
```

## Response Format Examples

### Authentication Success
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Login successful",
  "data": {
    "tokens": {
      "access_token": "...",
      "id_token": "...",
      "refresh_token": "..."
    }
  }
}
```

### Validation Error
```json
{
  "success": false,
  "statusCode": 400,
  "message": "Request validation failed.",
  "errorCode": "ValidationError",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email"
    }
  ],
  "data": null
}
```

### Business Logic Error
```json
{
  "success": false,
  "statusCode": 403,
  "message": "User is not approved for login.",
  "errorCode": "UserNotApproved",
  "data": null
}
```

## Monitoring Logs

### View logs in real-time (development)
Logs appear directly in your terminal/console.

### View logs in production
```bash
# View all errors from today
tail -f logs/error-$(date +%Y-%m-%d).log

# Search for specific user
grep "username.*johndoe" logs/*.log

# Count login attempts
grep -c "InitiateLogin" logs/info-*.log
```

## Troubleshooting

### Logs not being created
- Check `LOG_DIR` directory exists or is writable
- Verify `LOG_LEVEL` environment variable is set
- Check NODE_ENV is not in production without proper permissions

### Missing request/response logs
- Ensure `RequestResponseLoggingMiddleware` is registered BEFORE routes
- Verify `LOG_LEVEL` is set to `debug` for request details

### No logs in console
- In development: Logs should appear automatically
- In production: Console are disabled, check log files instead

## Performance Considerations

- **Logging overhead:** Minimal (async file operations)
- **Log file size:** Logs rotate daily, old logs can be archived
- **Memory usage:** Structured logging is memory-efficient

## Next Steps

1. Configure appropriate `LOG_LEVEL` for your environment
2. Set up log aggregation (CloudWatch, ELK, etc.)
3. Create alerts for ERROR level logs
4. Archive old logs regularly
5. Review logs periodically for security insights

For more details, see [TECHNICAL_REVIEW.md](TECHNICAL_REVIEW.md)
