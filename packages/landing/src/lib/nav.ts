export type ConsoleView = 'home' | 'agents' | 'tasks' | 'docs';

export const viewTitles: Record<ConsoleView, string> = {
  home: 'Home',
  agents: 'Agents',
  tasks: 'Tasks',
  docs: 'Docs',
};
