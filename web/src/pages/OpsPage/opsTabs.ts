export type OpsTabGroup = 'main' | 'more';

export interface OpsTab {
  to: string;
  label: string;
  group: OpsTabGroup;
  match: (path: string) => boolean;
}

const childRoute =
  (prefix: string) =>
  (path: string): boolean =>
    path.startsWith(prefix);

const todayTab: OpsTab = {
  to: '/ops/today',
  label: 'Today',
  group: 'main',
  match: (path) =>
    path === '/ops' ||
    path.startsWith('/ops?') ||
    path.startsWith('/ops/today'),
};

export const OPS_MESSAGES_PATH = '/ops/messages';

export const OPS_TABS: OpsTab[] = [
  todayTab,
  {
    to: '/ops/business',
    label: 'Business',
    group: 'main',
    match: childRoute('/ops/business'),
  },
  {
    to: '/ops/growth',
    label: 'Growth',
    group: 'main',
    match: childRoute('/ops/growth'),
  },
  {
    to: '/ops/flags',
    label: 'Flags',
    group: 'main',
    match: childRoute('/ops/flags'),
  },
  {
    to: '/ops/system',
    label: 'System',
    group: 'more',
    match: childRoute('/ops/system'),
  },
  {
    to: '/ops/errors',
    label: 'Errors',
    group: 'more',
    match: childRoute('/ops/errors'),
  },
  {
    to: OPS_MESSAGES_PATH,
    label: 'Messages',
    group: 'more',
    match: childRoute(OPS_MESSAGES_PATH),
  },
  {
    to: '/ops/tools',
    label: 'Tools',
    group: 'more',
    match: childRoute('/ops/tools'),
  },
  {
    to: '/ops/showcase',
    label: 'Showcase',
    group: 'more',
    match: childRoute('/ops/showcase'),
  },
];

export const OPS_MAIN_TABS = OPS_TABS.filter((tab) => tab.group === 'main');
export const OPS_MORE_TABS = OPS_TABS.filter((tab) => tab.group === 'more');
