import { PermissionCatalogService } from "./PermissionCatalogService";
import { RoleService } from "./RoleService";
import { RoleTemplateService } from "./RoleTemplateService";

export interface RoleManagementBootstrapDto {
  catalog: Awaited<ReturnType<typeof PermissionCatalogService.getCatalog>>;
  roles: Awaited<ReturnType<typeof RoleService.getRoles>>;
  templates: Awaited<ReturnType<typeof RoleTemplateService.getTemplates>>;
}

export class RoleManagementService {
  public static async getBootstrap(): Promise<RoleManagementBootstrapDto> {
    const [catalog, roles, templates] = await Promise.all([
      PermissionCatalogService.getCatalog(),
      RoleService.getRoles(true),
      RoleTemplateService.getTemplates()
    ]);

    return {
      catalog,
      roles,
      templates
    };
  }
}
