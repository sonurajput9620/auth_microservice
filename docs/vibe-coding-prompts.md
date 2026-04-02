# Step-By-Step Vibe Coding Prompt File

Use these prompts in order. Do not skip steps.

Before running Prompt 1, keep these docs open:
- `docs/project-analysis.md`
- `docs/db-structure.md`
- `docs/sql/001_role_management_schema.sql`
- `docs/api-spec.md`

## Global Rule For All Prompts

- Reuse existing table `app_user` as the user table.
- Do not create a new `users` table.
- All user assignment and user counts must use `app_user.role_id`.

## Prompt 1 - Align With Existing Backend Setup

```text
Analyze the existing backend project setup in this repository and summarize:
1) framework and folder structure,
2) ORM/query approach,
3) validation approach,
4) current auth middleware,
5) test framework.
Then propose a concrete implementation plan for role management that matches the existing patterns.
Do not write feature code yet. Output only the plan and file list.
```

## Prompt 2 - Add DB Migration And Models

```text
Implement MySQL schema for role management using the existing backend stack conventions.
Source of truth: docs/sql/001_role_management_schema.sql.

Requirements:
- create migration(s) for all tables and indexes,
- integrate with existing app_user table (do not create users table),
- add FK/index integration for app_user.role_id -> roles.id,
- add ORM models/entities/repositories,
- preserve naming compatibility with API contracts in docs/api-spec.md,
- no business logic yet.

After implementation, show exact files created/updated and migration run instructions.
```

## Prompt 3 - Seed Demo Catalog And Roles

```text
Create seed scripts for:
- default permission catalog (12 features, 70 sub-features) from frontend data,
- default system roles: Administrator, Operator, Executive Viewer,
- role_sub_feature_permissions for those roles.

Use stable seed behavior (idempotent upsert).
Return changed files and seed execution command.
```

## Prompt 4 - Build Catalog Read APIs

```text
Implement catalog read endpoints:
- GET /api/v1/permission-catalog
- GET /api/v1/permission-catalog/export?format=json|csv

Requirements:
- response shape must match frontend type contract,
- include only active features/sub-features by default,
- support stable ordering (group, sort_order, name),
- add request validation and error handling.

Add tests for both endpoints.
```

## Prompt 5 - Build Role CRUD APIs

```text
Implement role endpoints:
- GET /api/v1/roles
- GET /api/v1/roles/{roleId}
- POST /api/v1/roles
- PUT /api/v1/roles/{roleId}
- DELETE /api/v1/roles/{roleId}
- POST /api/v1/roles/{roleId}/duplicate

Rules:
- unique roleName (case-insensitive),
- cannot delete system role,
- cannot delete role with assigned active app_user rows,
- persist permissions at sub-feature level,
- return feature-grouped permissions in API response.

Add integration tests for create, update, duplicate, delete-rejection cases.
```

## Prompt 6 - Add Bootstrap Endpoint

```text
Implement GET /api/v1/role-management/bootstrap returning:
{
  catalog,
  roles,
  templates
}

Optimize to avoid N+1 queries.
Add one integration test that validates response schema and non-empty seed data.
```

## Prompt 7 - Build Role Template APIs

```text
Implement template endpoints:
- GET /api/v1/role-templates
- POST /api/v1/role-templates
- DELETE /api/v1/role-templates/{templateId}
- POST /api/v1/role-templates/{templateId}/apply-preview

Rules:
- unique templateName,
- apply-preview remaps to current active catalog,
- disabled/inactive catalog items should not be returned as enabled.

Add tests for save and apply-preview remap behavior.
```

## Prompt 8 - Catalog Import Validate/Apply

```text
Implement import flow endpoints:
- POST /api/v1/permission-catalog/import/validate
- POST /api/v1/permission-catalog/import/{importId}/apply
- POST /api/v1/permission-catalog/restore-demo
- POST /api/v1/permission-catalog/remap-roles

Validation rules must match docs/api-spec.md.
Apply operation must be transactional and audit into feature_import_jobs.
During remap:
- insert missing role/sub-feature permission rows disabled,
- disable permissions for inactive sub-features.

Add tests for successful import and rollback-on-error.
```

## Prompt 9 - Role Compare And App User Assignment APIs

```text
Implement:
- POST /api/v1/roles/compare
- GET /api/v1/users?roleId=
- PATCH /api/v1/users/{userId}/role

Requirements:
- these user endpoints must read/write existing app_user table,
- compare response should support current frontend side-by-side matrix,
- assignedUsersCount must update based on app_user table,
- reject assignment to inactive/non-existent role.

Add tests for compare diff and assignment validation.
```

## Prompt 10 - Authorization And Policy Layer

```text
Integrate endpoint-level authorization middleware for role-management APIs.
Use existing auth setup.
Enforce policy examples:
- catalog import/restore: admin-only,
- role create/update/delete: permission-managed,
- role read: allowed for role-management viewers.

Add tests for unauthorized and forbidden responses.
```

## Prompt 11 - Frontend Integration Refactor

```text
Update frontend to use backend APIs instead of localStorage-based RoleContext persistence.
Keep UI behavior unchanged.

Tasks:
- add API client methods matching docs/api-spec.md,
- replace RoleContext data loading/mutations with async calls,
- handle loading/error states,
- keep existing components and interaction flow.

Show changed frontend files and key behavior parity checks.
```

## Prompt 12 - Final Hardening

```text
Perform final hardening pass:
- add request/response schema docs (OpenAPI or equivalent),
- add logging around import/apply and role mutations,
- add pagination defaults for list endpoints,
- run lint + test + build,
- provide final implementation summary and known limitations.

Return exact commands executed and their outcomes.
```

## Suggested Execution Rule

After each prompt:
1. run tests,
2. run lint,
3. commit with a focused message,
4. proceed to next prompt.
