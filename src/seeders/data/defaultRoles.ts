export interface SeedSystemRole {
  uid: string;
  name: string;
  description: string;
  category: string;
}

export const DEFAULT_SYSTEM_ROLES: SeedSystemRole[] = [
  {
    uid: "1fce8f66-2d2b-4f45-9b3c-000000000001",
    name: "Administrator",
    description: "Full access to role management capabilities.",
    category: "Administration"
  },
  {
    uid: "1fce8f66-2d2b-4f45-9b3c-000000000002",
    name: "Operator",
    description: "Operational access for daily monitoring and execution.",
    category: "Operations"
  },
  {
    uid: "1fce8f66-2d2b-4f45-9b3c-000000000003",
    name: "Executive Viewer",
    description: "Read-focused access for dashboards and reports.",
    category: "Executive"
  }
];
