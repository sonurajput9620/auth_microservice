# Role Management Project Analysis And Flow

## 1. Scope And Current Repo State

- This repository currently contains a frontend-only React application.
- No backend source folder is present in this repo root (`src`, `public`, config files only).
- Current persistence is browser `localStorage`:
  - `purebi_roles`
  - `purebi_catalog`
  - `purebi_role_templates`

## 2. Existing Database Constraint From Your Side

- Existing user table must be reused: `app_user`.
- Role assignment column already exists in that table: `app_user.role_id`.
- Backend design must integrate role management with `app_user` instead of creating a new `users` table.

## 3. Current Frontend Architecture

- UI framework: React + TypeScript + Vite + shadcn UI.
- Route structure:
  - `/` -> Role Dashboard
  - `*` -> Not Found
- Global state:
  - `RoleProvider` in `src/context/RoleContext.tsx`
  - In-memory state + `localStorage` sync.

## 4. Core Domain Model (As Implemented In UI)

- `PermissionCatalog`
  - `features[]`
  - each feature has `subFeatures[]`.
- `Role`
  - identity and metadata (`name`, `description`, `category`, `type`, `status`)
  - `assignedUsersCount`
  - permission matrix by feature and sub-feature.
- `User` (frontend type)
  - should be mapped from `app_user` rows in backend.
- `RoleTemplate` (stored only in localStorage right now)
  - reusable permission matrix preset.

## 5. Existing User Flows

## 5.1 Dashboard Flow

1. Load roles and catalog from `RoleContext`.
2. Show summary stats:
   - total roles
   - active roles
   - feature count
   - assigned users sum.
3. Search roles by name/description.
4. Actions:
   - add role
   - edit role
   - preview role
   - duplicate role
   - delete custom role
   - import feature map
   - export feature map (JSON/CSV)
   - refresh/remap
   - restore demo catalog
   - compare roles.

## 5.2 Role Editor Flow

1. Create new role or load existing role.
2. Validate:
   - role name required
   - role description required
   - role name unique (case-insensitive logic in UI).
3. Manage permission grid:
   - select all / clear all
   - group-level toggle
   - feature-level toggle
   - sub-feature-level toggle
   - search and highlight.
4. Optional helpers:
   - copy permissions from another role
   - apply template
   - save template
   - AI suggestion panel (heuristic local rules).
5. Save role or save as copy.

## 5.3 Feature Map Import Flow

1. User pastes CSV text.
2. Frontend validates required columns and row-level shape.
3. Preview parsed catalog.
4. Apply import.
5. Role permissions are remapped against the new catalog.

## 5.4 Role Preview And Compare

- Preview: show enabled permissions for one role.
- Compare: side-by-side matrix for two roles and differences.

## 6. Gaps Blocking Dynamic Backend Mode

- No server persistence for roles/catalog/templates.
- No SQL schema for catalog/roles/permissions/templates (while `app_user` already exists).
- No APIs for CRUD/import/export/remap/compare.
- `assignedUsersCount` is static in role data; should be DB-derived from `app_user`.
- No server-side validation/authorization/audit.

## 7. Backend Modules Required

- `catalog` module
  - feature/sub-feature CRUD by import and restore.
- `roles` module
  - role CRUD, duplicate, compare, permission matrix save/load.
- `templates` module
  - save/apply role templates.
- `app-user integration` module
  - use `app_user.role_id` for assignment and counts.
- `imports` module
  - validate/apply catalog CSV in transaction.
- `authz` module
  - protect role-management endpoints by policy.

## 8. Data Facts From Seed Frontend Data

- Features: 12
- Sub-features: 70
- Default roles: 3 (`Administrator`, `Operator`, `Executive Viewer`)

## 9. Backend Integration Strategy

1. Build SQL schema + migration + seed (excluding creation of `app_user`).
2. Add FK/index integration between `roles` and `app_user.role_id`.
3. Implement catalog APIs first.
4. Implement roles and role-permission APIs.
5. Implement template APIs.
6. Implement import validate/apply transaction and remap logic.
7. Implement compare + bootstrap endpoint.
8. Wire frontend API client and remove localStorage persistence.
9. Add integration tests for role and catalog flows.

## 10. Recommended Initial API Consumption Pattern In Frontend

- Replace `RoleContext` localStorage loaders with:
  - `GET /api/v1/role-management/bootstrap` (single page-load call).
- Replace mutations:
  - add/update/delete/duplicate role endpoints
  - import/restore/remap endpoints
  - template endpoints
  - user-role assignment endpoint backed by `app_user`.
- Keep UI behavior same; only change data source and mutation handlers.
