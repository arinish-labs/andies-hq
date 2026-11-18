export const areas = ['Work', 'Personal'];
export const statuses = ['To Do', 'In Progress', 'Waiting', 'Done'];
export const blank = () => ({ version: 1, projects: [], tasks: [] });

const bangkok = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
});

export function today(now = new Date()) {
  const parts = Object.fromEntries(bangkok.formatToParts(now).map(({ type, value }) => [type, value]));
  return [parts.year, parts.month, parts.day].join('-');
}

export function offset(day, days) {
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function setStatus(task, status, now = new Date()) {
  if (!statuses.includes(status)) throw new Error('Choose a valid status.');
  return { ...task, status, completedAt: status === 'Done' ? task.completedAt ?? now.toISOString() : null };
}

export function makeTask(title, fields = {}, now = new Date()) {
  if (!title.trim()) throw new Error('Enter a task title.');
  return setStatus({
    id: crypto.randomUUID(), title: title.trim(), area: null, project: null,
    due: null, notes: '', createdAt: now.toISOString(), completedAt: null, ...fields
  }, fields.status ?? 'To Do', now);
}

export function removeProject(state, id) {
  return {
    ...state, projects: state.projects.filter(project => project.id !== id),
    tasks: state.tasks.map(task => task.project === id ? { ...task, project: null } : task)
  };
}

export function selectTasks(state, view, day = today(), query = '') {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const projects = new Map(state.projects.map(project => [project.id, project.name]));
  const matches = task => {
    const open = task.status !== 'Done';
    switch (view) {
      case 'Today': return open && task.due !== null && task.due <= day;
      case 'Upcoming': return open && task.due !== null && task.due > day;
      case 'Waiting': return task.status === 'Waiting';
      case 'Completed': return !open;
      case 'Inbox': return open && task.area === null;
      case 'Work':
      case 'Personal': return open && task.area === view;
      case 'Search': {
        const details = [task.title, task.notes, projects.get(task.project)].join(' ').toLowerCase();
        return words.every(word => details.includes(word));
      }
      default: return open && task.project === view.slice('project:'.length);
    }
  };
  return state.tasks.filter(matches).sort((a, b) => {
    if (view === 'Completed') return b.completedAt.localeCompare(a.completedAt);
    return (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.createdAt.localeCompare(b.createdAt);
  });
}

function validDay(value) {
  if (typeof value !== 'string' || value.startsWith('0000') || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

const named = value => typeof value === 'string' && value.trim().length > 0;

export function importBackup(json) {
  const value = JSON.parse(json);
  if (value?.version !== 1 || !Array.isArray(value.projects) || !Array.isArray(value.tasks)) {
    throw new Error('Choose a version 1 Andie’s HQ JSON backup.');
  }

  const projects = new Map();
  for (const project of value.projects) {
    if (!named(project?.id) || projects.has(project.id) || !named(project.name) || !areas.includes(project.area) ||
        (project.sample !== undefined && typeof project.sample !== 'boolean')) {
      throw new Error('The backup contains an invalid or duplicate project.');
    }
    projects.set(project.id, { id: project.id, name: project.name, area: project.area, ...(project.sample ? { sample: true } : {}) });
  }

  const ids = new Set();
  const tasks = value.tasks.map(task => {
    if (!named(task?.id) || ids.has(task.id) || !named(task.title) ||
        (task.area !== null && !areas.includes(task.area)) ||
        (task.project !== null && (!projects.has(task.project) || projects.get(task.project).area !== task.area)) ||
        !statuses.includes(task.status) || (task.due !== null && !validDay(task.due)) ||
        typeof task.notes !== 'string' || !validTimestamp(task.createdAt) ||
        (task.status === 'Done' ? !validTimestamp(task.completedAt) : task.completedAt !== null) ||
        (task.sample !== undefined && typeof task.sample !== 'boolean')) {
      throw new Error('The backup contains an invalid or duplicate task.');
    }
    ids.add(task.id);
    const { id, title, area, project, status, due, notes, createdAt, completedAt, sample } = task;
    return { id, title, area, project, status, due, notes, createdAt, completedAt, ...(sample ? { sample } : {}) };
  });
  return { version: 1, projects: [...projects.values()], tasks };
}

export const exportBackup = state => JSON.stringify(state, null, 2);

export function samples(day = today()) {
  const projects = [
    { id: 'project-studio', name: 'Studio refresh', area: 'Work', sample: true },
    { id: 'project-home', name: 'Home reset', area: 'Personal', sample: true }
  ];
  const task = (title, fields) => makeTask(title, { sample: true, ...fields });
  return {
    version: 1, projects, tasks: [
      task('Review homepage wireframes', { area: 'Work', project: 'project-studio', due: offset(day, -1), status: 'In Progress', notes: 'Check the mobile layout before sharing.' }),
      task('Send feedback to Mina', { area: 'Work', due: day }),
      task('Pick up a few groceries', { area: 'Personal', due: day }),
      task('Sketch ideas for the hallway', { area: 'Personal', project: 'project-home', due: day }),
      task('Plan next week’s priorities', { area: 'Work', due: offset(day, 2) }),
      task('Confirm the delivery window', { area: 'Personal', status: 'Waiting' }),
      task('Look up a new lunch spot', {}),
      task('Save the meeting notes', { area: 'Work', status: 'Done' })
    ]
  };
}

export function clearSamples(state) {
  const tasks = state.tasks.filter(task => !task.sample);
  const used = new Set(tasks.map(task => task.project));
  const projects = state.projects.filter(project => !project.sample || used.has(project.id));
  return { ...state, tasks, projects };
}
