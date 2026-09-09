export interface OpsTab {
  to: string;
  label: string;
  match: (path: string) => boolean;
}

const childRoute =
  (prefix: string) =>
  (path: string): boolean =>
    path.startsWith(prefix);

const todayTab: OpsTab = {
  to: '/ops/today',
  label: 'Today',
  match: (path) =>
    path === '/ops' ||
    path.startsWith('/ops?') ||
    path.startsWith('/ops/today'),
};

export const OPS_TABS: OpsTab[] = [
  todayTab,
  {
    to: '/ops/growth',
    label: 'Growth',
    match: childRoute('/ops/growth'),
  },
  {
    to: '/ops/business',
    label: 'Business',
    match: childRoute('/ops/business'),
  },
  {
    to: '/ops/system',
    label: 'System',
    match: childRoute('/ops/system'),
  },
  {
    to: '/ops/errors',
    label: 'Errors',
    match: childRoute('/ops/errors'),
  },
  {
    to: '/ops/messages',
    label: 'Messages',
    match: childRoute('/ops/messages'),
  },
  {
    to: '/ops/commands',
    label: 'Commands',
    match: childRoute('/ops/commands'),
  },
];
