/**
 * 待办/任务状态 UI：与 public.project_todos.status 及 ProjectTodoStatus 类型一致。
 * 按「状态值 + 当前查看者角色」显示 client 侧 / firm 侧文案与底色（附图规范）。
 */

/** DB 层状态默认展示标签（fallback） */
export const TODO_STATUS_LABEL: Record<string, string> = {
  to_submit:     'To Submit',
  reviewing:     'Reviewing',
  in_progress:   'In Progress',
  missing_info:  'Missing Info',
  completed:     'Completed',
  canceled:      'Canceled',
};

/** 标签底色：透明度较高，与可点击按钮区分 */
const STATUS_COLORS = {
  yellow:    'rgba(230, 126, 34, 0.48)',   // To Submit
  lightBlue: 'rgba(52, 152, 219, 0.42)',   // Reviewing(client)、Awaiting Client(firm) 等
  red:       'rgba(231, 76, 60, 0.48)',   // To Review(firm)、Missing Info(client)
  green:     'rgba(39, 174, 96, 0.48)',    // Completed
  gray:      'rgba(149, 165, 166, 0.48)',  // Canceled
} as const;

/**
 * 视角化状态标签：按附图「client 侧状态显示 / firm 侧状态显示」列，仅由 viewerRole 决定。
 * todoType 保留入参以兼容调用方，展示逻辑不依赖任务归属。
 */
export function getStatusLabel(
  status: string,
  _todoType: 'client' | 'firm',
  viewerRole: 'client' | 'firm',
): string {
  if (viewerRole === 'client') {
    switch (status) {
      case 'to_submit':     return 'To Submit';
      case 'reviewing':     return 'Reviewing';
      case 'in_progress':   return 'In Progress';
      case 'missing_info':  return 'Missing Info';
      case 'completed':     return 'Completed';
      case 'canceled':      return 'Canceled';
      default:              return TODO_STATUS_LABEL[status] ?? status;
    }
  }
  // firm 侧
  switch (status) {
    case 'to_submit':     return 'Awaiting Client';
    case 'reviewing':     return 'To Review';
    case 'in_progress':   return 'To Submit';
    case 'missing_info':  return 'Awaiting Client';
    case 'completed':     return 'Completed';
    case 'canceled':      return 'Canceled';
    default:              return TODO_STATUS_LABEL[status] ?? status;
  }
}

/**
 * 视角化状态颜色：按附图底色示意，client/firm 列分别对应黄/浅蓝/红/绿/灰，使用现有 UI 色号。
 */
export function getStatusColor(
  status: string,
  _todoType: 'client' | 'firm',
  viewerRole: 'client' | 'firm',
): string {
  if (viewerRole === 'client') {
    switch (status) {
      case 'to_submit':     return STATUS_COLORS.yellow;
      case 'reviewing':
      case 'in_progress':   return STATUS_COLORS.lightBlue;
      case 'missing_info':  return STATUS_COLORS.red;
      case 'completed':     return STATUS_COLORS.green;
      case 'canceled':      return STATUS_COLORS.gray;
      default:              return STATUS_COLORS.gray;
    }
  }
  // firm 侧
  switch (status) {
    case 'to_submit':
    case 'missing_info':   return STATUS_COLORS.lightBlue; // Awaiting Client
    case 'reviewing':      return STATUS_COLORS.red;       // To Review
    case 'in_progress':    return STATUS_COLORS.yellow;    // To Submit
    case 'completed':      return STATUS_COLORS.green;
    case 'canceled':       return STATUS_COLORS.gray;
    default:               return STATUS_COLORS.gray;
  }
}

/** 兼容：旧代码可能直接读 TODO_STATUS_COLOR */
export const TODO_STATUS_COLOR: Record<string, string> = {
  to_submit:     STATUS_COLORS.yellow,
  reviewing:     STATUS_COLORS.lightBlue,
  in_progress:   STATUS_COLORS.lightBlue,
  missing_info:  STATUS_COLORS.red,
  completed:     STATUS_COLORS.green,
  canceled:      STATUS_COLORS.gray,
};
