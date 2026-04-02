# API Documentation (Required For Current Frontend)

## 1. Base Conventions

- Base path: `/api/v1`
- Content type: `application/json`
- Auth: `Authorization: Bearer <token>` (recommended)
- Time format: ISO-8601 UTC
- Error format:

```json
{
  "code": "ROLE_NAME_EXISTS",
  "message": "Role name already exists.",
  "details": null
}
```

## 2. Core Response Shapes

## 2.1 Permission Catalog

```json
{
  "features": [
    {
      "featureGroup": "Administration",
      "featureId": "users-roles",
      "featureName": "Users & Roles",
      "featureDescription": "User and role management",
      "isSystemFeature": true,
      "isActive": true,
      "subFeatures": [
        {
          "subFeatureId": "users-edit-role",
          "subFeatureName": "Edit Role",
          "subFeatureDescription": "Edit existing roles",
          "isActive": true
        }
      ]
    }
  ]
}
```

## 2.2 Role

```json
{
  "roleId": "fd99c1f8-1454-4e8e-9be2-f3ca57e0d2f6",
  "roleName": "Operator",
  "roleDescription": "Operational access",
  "roleCategory": "Operations",
  "roleType": "System",
  "status": "Active",
  "assignedUsersCount": 8,
  "permissions": [
    {
      "featureId": "maintenance",
      "enabled": false,
      "subFeatures": [
        {
          "subFeatureId": "maint-equipment",
          "enabled": true
        }
      ]
    }
  ],
  "lastModified": "2026-03-31T08:30:00.000Z"
}
```

## 2.3 User Mapping (From Existing `app_user`)

Frontend user DTO should map from `app_user` as:

- `userId` <- `app_user.id`
- `userName` <- `app_user.username`
- `email` <- `app_user.email`
- `assignedRoleId` <- mapped from `app_user.role_id` to API `roleId` (role UID or numeric, based on backend contract)

## 3. Bootstrap Endpoint

Use this for first page load of `RoleDashboard`.

### `GET /api/v1/role-management/bootstrap`

Response:

```json
{
  "catalog": { "features": [] },
  "roles": [],
  "templates": []
}
```

## 4. Role APIs

### `GET /api/v1/roles`

Purpose:
- List roles for dashboard.

Query params:
- `search` (optional)
- `status` (`Active` or `Inactive`, optional)
- `includePermissions` (`true|false`, default `true`)

### `GET /api/v1/roles/{roleId}`

Purpose:
- Load role details for edit and preview screens.

### `POST /api/v1/roles`

Purpose:
- Create a new role.

Request:

```json
{
  "roleName": "Site Supervisor",
  "roleDescription": "Site supervision role",
  "roleCategory": "Operations",
  "status": "Active",
  "permissions": [
    {
      "featureId": "alerts",
      "subFeatures": [
        { "subFeatureId": "alerts-create", "enabled": true }
      ]
    }
  ]
}
```

Validations:
- `roleName` required and unique (case-insensitive).
- `roleDescription` required.
- All permission IDs must exist in active catalog.

### `PUT /api/v1/roles/{roleId}`

Purpose:
- Update role metadata + full permission matrix.

Rules:
- System role can be updated, but `roleType` cannot be changed.

### `DELETE /api/v1/roles/{roleId}`

Purpose:
- Delete a role.

Rules:
- Reject if role type is `System`.
- Reject if any active `app_user` rows are assigned.
- Use soft delete in DB.

### `POST /api/v1/roles/{roleId}/duplicate`

Purpose:
- Duplicate role exactly as dashboard currently does.

Request:

```json
{
  "nameSuffix": " (Copy)"
}
```

Response:
- Newly created role object.

### `POST /api/v1/roles/compare`

Purpose:
- Return role comparison matrix for compare screen.

Request:

```json
{
  "roleAId": "uuid-a",
  "roleBId": "uuid-b"
}
```

Response:
- Grouped feature/sub-feature diff structure.

## 5. Role Template APIs

### `GET /api/v1/role-templates`

Purpose:
- Load templates in role editor.

### `POST /api/v1/role-templates`

Purpose:
- Save current permission matrix as template.

Request:

```json
{
  "templateName": "Standard Operator",
  "permissions": [
    {
      "featureId": "pulse",
      "subFeatures": [
        { "subFeatureId": "pulse-kpi", "enabled": true }
      ]
    }
  ]
}
```

### `DELETE /api/v1/role-templates/{templateId}`

Purpose:
- Remove template.

### `POST /api/v1/role-templates/{templateId}/apply-preview`

Purpose:
- Return template permissions remapped to current catalog.

Response:
- Same shape as role `permissions` array.

## 6. Permission Catalog APIs

### `GET /api/v1/permission-catalog`

Purpose:
- Fetch full catalog for grid rendering and exports.

### `POST /api/v1/permission-catalog/import/validate`

Purpose:
- Server-side CSV/JSON validation before apply.

Request:

```json
{
  "format": "csv",
  "rawData": "featureGroup,featureId,featureName,..."
}
```

Response:

```json
{
  "importId": "a4d8...",
  "valid": true,
  "totalRows": 70,
  "validRows": 70,
  "errors": [],
  "warnings": [],
  "previewCatalog": { "features": [] }
}
```

### `POST /api/v1/permission-catalog/import/{importId}/apply`

Purpose:
- Apply validated import transactionally.

Behavior:
- Upsert features/sub-features.
- Mark removed entries inactive.
- Remap role permission rows.
- Store import audit record.

### `POST /api/v1/permission-catalog/restore-demo`

Purpose:
- Restore built-in demo catalog and remap all roles.

### `POST /api/v1/permission-catalog/remap-roles`

Purpose:
- Equivalent to current frontend `Refresh` action.

Behavior:
- Rebuild missing role/sub-feature permission rows.
- Disable permissions for inactive or removed sub-features.

### `GET /api/v1/permission-catalog/export?format=json|csv`

Purpose:
- Server-generated export to keep format consistent.

Response:
- `application/json` or `text/csv` file stream.

## 7. App User APIs (Backed By Existing `app_user` Table)

To minimize frontend changes, keep route names as `/users`, but read/write from `app_user`.

### `GET /api/v1/users?roleId=<optional>`

Purpose:
- List users (from `app_user`), optionally filtered by role.

### `PATCH /api/v1/users/{userId}/role`

Purpose:
- Assign/unassign role in `app_user.role_id`.

Request:

```json
{
  "roleId": "fd99c1f8-1454-4e8e-9be2-f3ca57e0d2f6"
}
```

Rules:
- Role must exist and be active.

## 8. Optional AI Suggestion API (Future)

Frontend currently uses a local heuristic assistant. If moving AI logic server-side:

### `POST /api/v1/roles/suggest-permissions`

Request:

```json
{
  "roleName": "Maintenance Engineer",
  "roleDescription": "...",
  "roleCategory": "Maintenance"
}
```

Response:
- Suggested permission matrix + confidence metadata.

## 9. Error Codes To Standardize

- `ROLE_NAME_EXISTS`
- `ROLE_NOT_FOUND`
- `ROLE_DELETE_SYSTEM_FORBIDDEN`
- `ROLE_DELETE_ASSIGNED_USERS`
- `INVALID_PERMISSION_REFERENCE`
- `CATALOG_IMPORT_INVALID`
- `CATALOG_IMPORT_NOT_FOUND`
- `TEMPLATE_NAME_EXISTS`
- `TEMPLATE_NOT_FOUND`
- `USER_NOT_FOUND`
- `ROLE_INACTIVE`
- `UNAUTHORIZED`
- `FORBIDDEN`

## 10. Minimum Endpoint Implementation Order

1. `GET /role-management/bootstrap`
2. Role CRUD + duplicate
3. `GET /permission-catalog`
4. Catalog import validate/apply + restore + remap
5. Template APIs
6. Compare endpoint
7. `app_user` assignment endpoint (`PATCH /users/{userId}/role`)
