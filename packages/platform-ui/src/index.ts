export { SpaceSwitcherModal } from './SpaceSwitcherModal';
export { ThirdPartyAuthButtons } from './ThirdPartyAuthButtons';
export { configureProductUi, getProductUi, getManagementMenu, KERNEL_MANAGEMENT_MENU } from './product';
export type { ProductUiConfig, SpaceKindOption, SetupExtrasContext, SidebarNavItem, ManagementMenuItem } from './product';

export { showToast, subscribeToast } from './lib/toast';
export type { ToastPayload, ToastType } from './lib/toast';
export { confirmDestructive, confirmThen, showAlert } from './lib/alertWeb';
export { setConfirmDialogListener, showAlertDialog, showConfirmDialog, showConfirmDestructiveDialog, showChoiceDialog } from './lib/confirmDialog';
export type { ConfirmDialogState, ConfirmDialogButton } from './lib/confirmDialog';

export { GradientText } from './lib/GradientText';

export { ToastHost } from './components/ToastHost';
export { ConfirmModalHost } from './components/ConfirmModalHost';

export { default as ManagementScreen } from './screens/ManagementScreen';
export { default as LoginScreen } from './screens/LoginScreen';
export { default as RegisterScreen } from './screens/RegisterScreen';
export { default as ResetPasswordScreen } from './screens/ResetPasswordScreen';
export { default as SetupSpaceScreen } from './screens/SetupSpaceScreen';
export { default as SpaceMembersScreen } from './screens/SpaceMembersScreen';
export { default as HandleInvitationsScreen } from './screens/HandleInvitationsScreen';
export { default as InviteScreen } from './screens/InviteScreen';
export { default as SpaceRolesScreen } from './screens/SpaceRolesScreen';

export { default as WebSidebar, shouldShowWebSidebar } from './chrome/WebSidebar';

export { default as DataTable, WEB_POPOVER, measureTableTextWidthPx, minWidthForChars, minWidthForContentSamples } from './list/DataTable';
export type { DataTableColumn, DataTableSection, DataTableProps } from './list/DataTable';
export { default as CenterModal } from './list/CenterModal';
export {
  ProjectListCard,
  ProjectListRow,
  projectListStyles,
  GRID_GAP,
  LIST_ROW_MIN_HEIGHT,
  LIST_STATUS_WRAP_WIDTH,
  ACTION_ROW_HEIGHT,
  PinToTopIcon,
  LIST_ACTION_GRAY,
} from './list/ProjectListCardAndRow';
export type { ProjectListCardItem } from './list/ProjectListCardAndRow';
export {
  SERVICE_CATALOG_CARD_MAX_WIDTH,
  skuToCatalogListItem,
  ServiceCatalogAddEntryTile,
  serviceCatalogListStyles,
} from './list/CatalogShared';
export type { CatalogSkuLike } from './list/CatalogShared';
export { useWebViewportKind, isMobileWebWidth, MOBILE_WEB_MAX_WIDTH } from './lib/web-viewport';

