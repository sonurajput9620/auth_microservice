export interface SeedSubFeature {
  key: string;
  name: string;
  description: string;
}

export interface SeedFeature {
  key: string;
  group: string;
  name: string;
  description: string;
  isSystemFeature: boolean;
  sortOrder: number;
  subFeatures: SeedSubFeature[];
}

export const DEFAULT_CATALOG_VERSION_CODE = "demo-v1";

export const DEFAULT_PERMISSION_CATALOG: SeedFeature[] = [
  {
    key: "users-roles",
    group: "Administration",
    name: "Users & Roles",
    description: "User and role administration",
    isSystemFeature: true,
    sortOrder: 1,
    subFeatures: [
      { key: "users-list", name: "List Users", description: "View user list" },
      { key: "users-create", name: "Create User", description: "Create users" },
      { key: "users-edit", name: "Edit User", description: "Update user details" },
      { key: "users-disable", name: "Disable User", description: "Disable user access" },
      { key: "users-assign-role", name: "Assign Role", description: "Assign role to users" },
      { key: "users-edit-role", name: "Edit Role", description: "Edit existing roles" }
    ]
  },
  {
    key: "alerts",
    group: "Operations",
    name: "Alerts",
    description: "Alert operations",
    isSystemFeature: true,
    sortOrder: 2,
    subFeatures: [
      { key: "alerts-list", name: "List Alerts", description: "View alerts" },
      { key: "alerts-create", name: "Create Alert", description: "Create alerts" },
      { key: "alerts-edit", name: "Edit Alert", description: "Edit alerts" },
      { key: "alerts-delete", name: "Delete Alert", description: "Delete alerts" },
      { key: "alerts-ack", name: "Acknowledge Alert", description: "Acknowledge alerts" },
      { key: "alerts-assign", name: "Assign Alert", description: "Assign alerts" },
      { key: "alerts-close", name: "Close Alert", description: "Close alerts" },
      { key: "alerts-history", name: "Alert History", description: "View alert history" }
    ]
  },
  {
    key: "maintenance",
    group: "Operations",
    name: "Maintenance",
    description: "Maintenance workflows",
    isSystemFeature: false,
    sortOrder: 3,
    subFeatures: [
      { key: "maint-equipment", name: "Equipment", description: "View equipment" },
      { key: "maint-workorders-list", name: "List Work Orders", description: "View work orders" },
      { key: "maint-workorders-create", name: "Create Work Order", description: "Create work orders" },
      { key: "maint-workorders-update", name: "Update Work Order", description: "Update work orders" },
      { key: "maint-schedules", name: "Schedules", description: "View maintenance schedules" },
      { key: "maint-checklists", name: "Checklists", description: "Manage maintenance checklists" }
    ]
  },
  {
    key: "pulse",
    group: "Monitoring",
    name: "Pulse",
    description: "Live KPI and pulse widgets",
    isSystemFeature: false,
    sortOrder: 4,
    subFeatures: [
      { key: "pulse-kpi", name: "KPI", description: "View pulse KPIs" },
      { key: "pulse-trends", name: "Trends", description: "View pulse trends" },
      { key: "pulse-anomalies", name: "Anomalies", description: "View anomalies" },
      { key: "pulse-drilldown", name: "Drilldown", description: "Drill down pulse data" },
      { key: "pulse-config", name: "Pulse Config", description: "Configure pulse" }
    ]
  },
  {
    key: "reports",
    group: "Reporting",
    name: "Reports",
    description: "Report creation and scheduling",
    isSystemFeature: false,
    sortOrder: 5,
    subFeatures: [
      { key: "reports-list", name: "List Reports", description: "View reports" },
      { key: "reports-create", name: "Create Report", description: "Create reports" },
      { key: "reports-edit", name: "Edit Report", description: "Edit reports" },
      { key: "reports-delete", name: "Delete Report", description: "Delete reports" },
      { key: "reports-run", name: "Run Report", description: "Run reports" },
      { key: "reports-export", name: "Export Report", description: "Export reports" },
      { key: "reports-schedule", name: "Schedule Report", description: "Schedule reports" }
    ]
  },
  {
    key: "dashboards",
    group: "Reporting",
    name: "Dashboards",
    description: "Dashboard management",
    isSystemFeature: false,
    sortOrder: 6,
    subFeatures: [
      { key: "dashboards-list", name: "List Dashboards", description: "View dashboards" },
      { key: "dashboards-create", name: "Create Dashboard", description: "Create dashboards" },
      { key: "dashboards-edit", name: "Edit Dashboard", description: "Edit dashboards" },
      { key: "dashboards-delete", name: "Delete Dashboard", description: "Delete dashboards" },
      { key: "dashboards-share", name: "Share Dashboard", description: "Share dashboards" },
      { key: "dashboards-publish", name: "Publish Dashboard", description: "Publish dashboards" }
    ]
  },
  {
    key: "notifications",
    group: "Communication",
    name: "Notifications",
    description: "Notification channels and preferences",
    isSystemFeature: false,
    sortOrder: 7,
    subFeatures: [
      { key: "notifications-view", name: "View Notifications", description: "View notifications" },
      { key: "notifications-send", name: "Send Notification", description: "Send notifications" },
      { key: "notifications-manage-templates", name: "Manage Templates", description: "Manage notification templates" },
      { key: "notifications-channel-config", name: "Channel Config", description: "Configure channels" },
      { key: "notifications-webhooks", name: "Webhooks", description: "Manage notification webhooks" }
    ]
  },
  {
    key: "sites",
    group: "Administration",
    name: "Sites",
    description: "Site hierarchy and configuration",
    isSystemFeature: true,
    sortOrder: 8,
    subFeatures: [
      { key: "sites-list", name: "List Sites", description: "View sites" },
      { key: "sites-create", name: "Create Site", description: "Create sites" },
      { key: "sites-edit", name: "Edit Site", description: "Edit sites" },
      { key: "sites-delete", name: "Delete Site", description: "Delete sites" },
      { key: "sites-map", name: "Site Mapping", description: "Map site relationships" },
      { key: "sites-groups", name: "Site Groups", description: "Manage site groups" }
    ]
  },
  {
    key: "analytics",
    group: "Insights",
    name: "Analytics",
    description: "Analytical tools",
    isSystemFeature: false,
    sortOrder: 9,
    subFeatures: [
      { key: "analytics-overview", name: "Overview", description: "View analytics overview" },
      { key: "analytics-funnels", name: "Funnels", description: "View funnels" },
      { key: "analytics-segments", name: "Segments", description: "Use segments" },
      { key: "analytics-cohorts", name: "Cohorts", description: "Use cohorts" },
      { key: "analytics-export", name: "Export Analytics", description: "Export analytics" }
    ]
  },
  {
    key: "data-upload",
    group: "Data",
    name: "Data Upload",
    description: "Data ingestion operations",
    isSystemFeature: false,
    sortOrder: 10,
    subFeatures: [
      { key: "data-upload-csv", name: "Upload CSV", description: "Upload CSV data" },
      { key: "data-upload-json", name: "Upload JSON", description: "Upload JSON data" },
      { key: "data-upload-history", name: "Upload History", description: "View upload history" },
      { key: "data-upload-validate", name: "Validate Upload", description: "Validate upload files" },
      { key: "data-upload-rollback", name: "Rollback Upload", description: "Rollback uploaded data" },
      { key: "data-upload-schedule", name: "Schedule Upload", description: "Schedule ingestion jobs" }
    ]
  },
  {
    key: "settings",
    group: "Administration",
    name: "Settings",
    description: "Platform settings",
    isSystemFeature: true,
    sortOrder: 11,
    subFeatures: [
      { key: "settings-general", name: "General Settings", description: "Manage general settings" },
      { key: "settings-security", name: "Security Settings", description: "Manage security settings" },
      { key: "settings-integrations", name: "Integrations", description: "Manage integrations" },
      { key: "settings-api-keys", name: "API Keys", description: "Manage API keys" },
      { key: "settings-audit-logs", name: "Audit Logs", description: "View audit logs" }
    ]
  },
  {
    key: "ai-assistant",
    group: "Insights",
    name: "AI Assistant",
    description: "AI assistance and analysis",
    isSystemFeature: false,
    sortOrder: 12,
    subFeatures: [
      { key: "ai-chat", name: "AI Chat", description: "Use AI chat" },
      { key: "ai-analyze-alert", name: "Analyze Alert", description: "Run AI alert analysis" },
      { key: "ai-suggest-permissions", name: "Suggest Permissions", description: "Get role permission suggestions" },
      { key: "ai-history", name: "AI History", description: "View AI run history" },
      { key: "ai-feedback", name: "AI Feedback", description: "Submit AI feedback" }
    ]
  }
];
