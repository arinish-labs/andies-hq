import {
  areas, statuses, bangkokClock, isOverdue, offset, saveTask, setStatus, selectTasks, samples,
  importBackup, exportBackup, removeProject, clearSamples
} from './model.mjs?v=1.2';
import { cleanDescription, descriptionHtml, mountDescription } from './description.mjs?v=1.2';

const icons = {
  Today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  Upcoming: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18m-13 5h2m4 0h2"/>',
  Waiting: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  Completed: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5 5.5-5.5"/>',
  Work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M3 12h18m-9 0v2"/>',
  Personal: '<path d="M20 9c0 5-8 10-8 10S4 14 4 9a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9Z"/>',
  Search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  More: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  Backup: '<path d="M4 7h16v13H4zM3 4h18v3H3zm6 8h6"/>',
  project: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  arrow: '<path d="m9 6 6 6-6 6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.project}</svg>`;
const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const $ = selector => document.querySelector(selector);
const storageKey = 'andie-flow-v1';
const draftKey = id => `${storageKey}-draft-${id ? 'task-' + id : 'new'}`;

function readBackup(json) {
  const snapshot = importBackup(json);
  for (const task of snapshot.tasks) {
    if (task.description === undefined) continue;
    const description = cleanDescription(task.description);
    task.description = description.html;
    task.notes = description.text;
  }
  return snapshot;
}
const navigation = ['Today', ...areas, 'Upcoming', 'More'];
const editor = $('#editor');
const confirmDialog = $('#confirm');
let state;
let loadError = '';
let needsSave = false;
try {
  const saved = localStorage.getItem(storageKey);
  state = saved === null ? samples() : readBackup(saved);
  needsSave = saved === null;
} catch {
  loadError = 'Andie’s HQ could not read its local data. Browser storage may be unavailable or the saved data may be damaged.';
}
let view = 'Today';
let query = '';
let clock = bangkokClock();
let noticeTimer;

function announce(message) {
  $('#notice').textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('#notice').textContent = ''; }, 4500);
}

function save(next) {
  try {
    localStorage.setItem(storageKey, exportBackup(next));
  } catch {
    announce('Could not save on this device. Your previous data is unchanged.');
    return false;
  }
  state = next;
  return true;
}

function dateLabel(date, options) {
  return new Intl.DateTimeFormat('en', { timeZone: 'Asia/Bangkok', ...options })
    .format(new Date(date.length === 10 ? date + 'T00:00:00Z' : date));
}

function projectFor(id) {
  return state.projects.find(project => project.id === id);
}

function viewName(key) {
  return key.startsWith('project:') ? projectFor(key.slice(8))?.name ?? 'Today' : key;
}

function navButton(key, { count = false, iconName = key, className = '', active = key === view } = {}) {
  const name = viewName(key);
  return `<button class="nav-item ${className}" type="button" data-view="${escape(key)}" ${active ? 'aria-current="page"' : ''}>
    ${icon(iconName)}<span>${escape(name)}</span>${count ? `<small>${selectTasks(state, key, clock.day).length}</small>` : ''}
  </button>`;
}

function navGroup(title, entries) {
  return `<div class="nav-group"><h2>${title}</h2>${entries.join('')}</div>`;
}

function readView() {
  try {
    const key = decodeURIComponent(location.hash.slice(1));
    if (key === 'Inbox') return 'Work';
    if ([...navigation, 'Waiting', 'Completed', 'Search', 'Backup'].includes(key) ||
        (key.startsWith('project:') && projectFor(key.slice(8)))) return key;
  } catch {
    return 'Today';
  }
  return 'Today';
}

function go(key) {
  if (key !== view) {
    location.hash = encodeURIComponent(key);
    view = key;
    render();
    window.scrollTo(0, 0);
  }
  if (key === 'Search') $('#query')?.focus();
}

const descriptions = {
  Today: 'Due today and overdue',
  Upcoming: 'Tasks due after today.',
  Waiting: 'Tasks that are on hold.',
  Completed: 'Your finished tasks.',
  Work: 'Tasks and projects for work.',
  Personal: 'Tasks and projects for personal life.'
};
const empty = {
  Today: ['You’re all caught up', 'Tasks with a due date of today or earlier will show up here.'],
  Upcoming: ['Nothing upcoming', 'Give a task a future due date to see it here.'],
  Waiting: ['Nothing on hold', 'Set a task to Waiting to see it here.'],
  Completed: ['No completed tasks yet', 'Finished tasks will appear here. You can reopen them anytime.'],
  Search: ['No matching tasks', 'Try a different word from the title, description, or project name.']
};

function card(task) {
  const project = projectFor(task.project);
  const done = task.status === 'Done';
  const late = isOverdue(task, clock);
  const dueLabel = task.due === clock.day && !task.dueTime ? 'Today' : task.due ?
    dateLabel(task.due, { month: 'short', day: 'numeric', ...(task.due.slice(0, 4) === clock.day.slice(0, 4) ? {} : { year: 'numeric' }) }) : '';
  const scheduled = task.dueTime ? `${dueLabel} · ${task.dueTime}` : dueLabel;
  return `<li class="task ${done ? 'done' : ''}">
    <button type="button" class="task-check" data-toggle="${escape(task.id)}" aria-label="${done ? 'Reopen' : 'Complete'} ${escape(task.title)}"><span>${done ? icon('check') : ''}</span></button>
    <button type="button" class="task-info" data-detail="${escape(task.id)}">
      <span class="task-title">${escape(task.title)}</span>
      <span class="task-meta"><span class="home ${task.area.toLowerCase()}"><i></i>${task.area}</span>
      ${project ? `<span class="project-name">${escape(project.name)}</span>` : ''}
      ${task.status === 'To Do' || done ? '' : `<span class="status">${task.status}</span>`}</span>
    </button>
    ${done ? `<span class="due"><span>${task.dueTime ? `Due ${scheduled}<br>Completed ` : ''}${dateLabel(task.completedAt, { month: 'short', day: 'numeric', year: 'numeric' })}</span></span>` :
      task.due ? `<span class="due ${late ? 'overdue' : ''}">${icon('Upcoming')}${late ? 'Overdue · ' : ''}${scheduled}</span>` : ''}
    <button type="button" class="icon-button edit-button" data-edit="${escape(task.id)}" aria-label="Edit ${escape(task.title)}">${icon('More')}</button>
  </li>`;
}

function taskList(tasks) {
  if (tasks.length) return `<ul class="task-list">${tasks.map(card).join('')}</ul>`;
  const [heading, message] = empty[view] ?? ['No open tasks', 'Organize a task here from its task editor.'];
  return `<div class="empty"><span class="empty-icon">${icon(view)}</span><h2>${heading}</h2><p>${message}</p></div>`;
}

function todayView(tasks) {
  const overdue = tasks.filter(task => isOverdue(task, clock)).length;
  return `<section class="hero">
    <div class="hero-content"><div class="hero-date">${icon('Upcoming')}${dateLabel(clock.day, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      <h1>Today</h1><p>${descriptions.Today}</p>
    </div>
    <div class="hero-art" aria-hidden="true"><span></span><span></span><span></span><i></i><b>✦</b><em>✧</em></div>
  </section>
  <div class="section-heading"><div><h2>Your tasks</h2><span class="count">${tasks.length}</span></div>
  ${overdue ? `<span class="late-count"><i></i>${overdue} overdue</span>` : ''}</div>
  ${taskList(tasks)}
  <button class="inline-add open-add" type="button">${icon('plus')} Add a task</button>`;
}

function areaProjects(area) {
  const projects = state.projects.filter(project => project.area === area);
  return `<div class="section-heading"><h2>Projects</h2><button type="button" class="secondary" data-project-new="${area}">${icon('plus')} New project</button></div>
    <div class="project-grid">${projects.map(project => navButton('project:' + project.id, { count: true, className: 'project-card' })).join('') ||
      '<p class="form-hint">No projects yet. Tasks can live directly in this area.</p>'}</div>`;
}

function backupView() {
  const cleared = clearSamples(state);
  const hasSamples = cleared.tasks.length !== state.tasks.length || cleared.projects.length !== state.projects.length;
  return `<div class="page-heading"><h1>Data & backups</h1><p>Keep a copy of your tasks and projects.</p></div>
    <section class="settings"><h2>Backups</h2><p>Export a JSON file to save in Files. Importing a backup replaces the tasks and projects on this device.</p>
      <div class="button-row"><button class="secondary" type="button" data-action="export">Export JSON</button><button class="secondary" type="button" data-action="import">Import JSON</button></div>
      <input id="backup-file" type="file" accept=".json,application/json" hidden>
    </section>
    <section class="settings"><h2>Sample data</h2><p>Remove the example tasks and any unused example projects.</p>
      <button class="secondary" type="button" data-action="clear" ${hasSamples ? '' : 'disabled'}>Clear sample data</button>
    </section>`;
}

function render() {
  if (loadError) {
    $('#main').textContent = loadError;
    return;
  }
  $('.sidebar .open-add').innerHTML = icon('plus') + ' Quick Add';
  const navItems = (count = false) => navigation.map(key => navButton(key, {
    count: count && key === 'Today',
    active: key === 'More' ? !navigation.slice(0, -1).includes(view) && view !== 'Search' : key === view
  }));
  $('#sidebar-nav').innerHTML = navGroup('WORKSPACE', navItems(true));
  $('#bottom-nav').innerHTML = navItems().join('');
  $('.mobile-add').innerHTML = icon('plus');
  $('.search-button').innerHTML = icon('Search') + '<span>Search tasks</span>';
  $('.search-button').setAttribute('aria-label', 'Search tasks');
  $('#crumb').textContent = view === 'Backup' ? 'Data & backups' : viewName(view);
  const tasks = selectTasks(state, view, clock.day, query);
  const main = $('#main');
  if (view === 'Today') main.innerHTML = todayView(tasks);
  else if (view === 'More') {
    main.innerHTML = `<div class="page-heading"><h1>More</h1></div>${navGroup('SMART VIEWS', [navButton('Waiting'), navButton('Completed')])}
      ${navGroup('DATA', [navButton('Backup').replace('>Backup<', '>Data & backups<')])}`;
  } else if (view === 'Backup') main.innerHTML = backupView();
  else if (view === 'Search') {
    main.innerHTML = `<div class="page-heading"><h1>Search</h1><p>Find open and completed tasks.</p></div>
      <label class="search-field">${icon('Search')}<input id="query" type="search" aria-label="Search tasks" placeholder="Title, description, or project" value="${escape(query)}"></label>
      <div id="search-results">${taskList(tasks)}</div>`;
  } else {
    const project = view.startsWith('project:') ? projectFor(view.slice(8)) : null;
    const isArea = areas.includes(view);
    main.innerHTML = `<div class="page-heading"><h1>${escape(viewName(view))}</h1><p>${project?.area ?? descriptions[view]}</p>
      ${project ? '<button type="button" class="secondary" data-action="edit-project">Edit project</button>' : ''}</div>
      ${isArea ? areaProjects(view) : ''}
      <div class="section-heading"><div><h2>${view === 'Completed' ? 'Completed tasks' : 'Tasks'}</h2><span class="count">${tasks.length}</span></div></div>
      ${taskList(tasks)}`;
  }
}

function dialogFrame(title, body) {
  editor.innerHTML = `<div class="dialog-heading"><h2 id="editor-title">${title}</h2>
    <button class="icon-button" type="button" data-action="close" aria-label="Close">${icon('close')}</button></div>${body}`;
  if (!editor.open) editor.showModal();
  else (editor.querySelector('[autofocus]') ?? editor.querySelector('button')).focus();
}

const option = (value, label, selected) =>
  `<option value="${escape(value)}"${value === selected ? ' selected' : ''}>${escape(label)}</option>`;

const areaOptions = selected => areas.map(area => option(area, area, selected)).join('');

function projectOptions(area, selected) {
  return option('', 'No project', selected) + state.projects.filter(project => project.area === area)
    .map(project => option(project.id, project.name, selected)).join('');
}

const dateShortcuts = [['Today', 0], ['Tomorrow', 1], ['Next Week', 7]];
const formatting = [
  ['bold', 'Bold', '<b>B</b>'], ['italic', 'Italic', '<i>I</i>'],
  ['insertUnorderedList', 'Bullet list', '• List'], ['insertOrderedList', 'Numbered list', '1. List'],
  ['checklist', 'Checklist', '☐ List'], ['checked', 'Check or uncheck item', '✓ Item'],
  ['link', 'Add link', 'Link']
];

function taskForm(task) {
  const id = task?.id ?? '';
  const initial = {
    title: task?.title ?? '', area: task?.area ?? state.quickArea, project: task?.project ?? '',
    due: task?.due ?? '', dueTime: task?.dueTime ?? '', status: task?.status ?? 'To Do',
    description: task ? descriptionHtml(task) : ''
  };
  let draft;
  try {
    draft = JSON.parse(localStorage.getItem(draftKey(id)));
    if (!draft || !Object.keys(initial).every(key => typeof draft[key] === 'string') ||
        !areas.includes(draft.area) || !statuses.includes(draft.status)) draft = null;
  } catch {
    draft = null;
  }
  const fields = draft ?? initial;
  dialogFrame(task ? 'Edit task' : 'Add task', `<form id="task-form" data-id="${escape(id)}">
    <label>Task title<input name="title" required placeholder="What do you need to do?" value="${escape(fields.title)}" autofocus></label>
    <div class="form-grid">
      <label>Area<select name="area" required>${areaOptions(fields.area)}</select></label>
      <label>Project<select name="project">${projectOptions(fields.area, fields.project)}</select></label>
      <label>Due date<input name="due" type="date" min="0001-01-01" max="9999-12-31" value="${escape(fields.due)}"></label>
      <label>Due time (Bangkok)<input name="dueTime" type="time" lang="en-GB" step="60" value="${escape(fields.dueTime)}"></label>
      <div class="date-shortcuts" role="group" aria-label="Due date shortcuts">${dateShortcuts.map(([label, days]) =>
        `<button type="button" class="secondary" data-date-offset="${days}">${label}</button>`).join('')}</div>
      <label>Status<select name="status">${statuses.map(status => option(status, status, fields.status)).join('')}</select></label>
    </div>
    <div class="description-editor">
      <span id="description-label">Description</span>
      <div class="format-buttons" role="group" aria-label="Description formatting">${formatting.map(([command, label, text]) =>
        `<button type="button" class="secondary" data-format="${command}" aria-label="${label}" title="${label}">${text}</button>`).join('')}</div>
      <div class="rich-text" id="task-description" contenteditable="true" role="textbox" aria-labelledby="description-label" aria-multiline="true"></div>
    </div>
    <div class="form-error" role="alert"></div>
    <div class="dialog-actions"><button type="button" class="secondary" data-action="close">Cancel</button>
      ${task ? `<button type="button" class="danger" data-delete-task="${escape(id)}">Delete task</button>` : ''}
      <button class="primary" type="submit">Save Task</button></div></form>`);
  const form = $('#task-form');
  const field = $('#task-description');
  field.innerHTML = draft ? cleanDescription(draft.description).html : initial.description;
  const originalDescription = cleanDescription(initial.description).html;
  const baseline = JSON.stringify({ ...initial, description: originalDescription });
  const compareTask = value => JSON.stringify(value, Object.keys(value ?? {}).sort());
  const originalTask = compareTask(task);
  form.taskChangedElsewhere = () => Boolean(id) && compareTask(state.tasks.find(item => item.id === id)) !== originalTask;
  form.details = () => {
    const description = cleanDescription(field.innerHTML);
    return { values: { ...Object.fromEntries(new FormData(form)), description: description.html }, notes: description.text };
  };
  form.hasChanges = () => JSON.stringify(form.details().values) !== baseline;
  form.hasDescriptionChanges = description => description !== originalDescription;
  form.clearDraft = () => {
    try { localStorage.removeItem(draftKey(id)); } catch { /* Storage may be unavailable. */ }
  };
  const persistDraft = () => {
    const snapshot = JSON.stringify(form.details().values);
    try {
      if (snapshot === baseline) form.clearDraft();
      else localStorage.setItem(draftKey(id), snapshot);
    } catch { /* The discard warning remains available. */ }
  };
  form.addEventListener('input', persistDraft);
  form.addEventListener('change', persistDraft);
  mountDescription(field, form.querySelector('.format-buttons'), persistDraft);
}

function taskDetail(task) {
  const project = projectFor(task.project);
  const due = task.due ? dateLabel(task.due, { month: 'long', day: 'numeric', year: 'numeric' }) : 'No due date';
  const description = descriptionHtml(task);
  dialogFrame(escape(task.title), `<div class="task-detail">
    <dl><dt>Area</dt><dd>${task.area}</dd>
      ${project ? `<dt>Project</dt><dd>${escape(project.name)}</dd>` : ''}
      <dt>Status</dt><dd>${task.status}</dd>
      <dt>Due</dt><dd>${due}${task.dueTime ? ` · ${task.dueTime} (Bangkok)` : ''}</dd></dl>
    ${description ? `<h3>Description</h3><div class="rich-text">${description}</div>` : ''}
    <div class="dialog-actions">
      <button type="button" class="secondary" data-edit="${escape(task.id)}">Edit</button>
      <button type="button" class="primary" data-toggle="${escape(task.id)}">${task.status === 'Done' ? 'Reopen' : 'Complete'}</button>
    </div></div>`);
}

function closeEditor() {
  const form = editor.querySelector('#task-form');
  if (!form?.hasChanges()) {
    editor.close();
    return;
  }
  confirmAction('Discard unsaved changes?', 'You can cancel to keep editing this task.', 'Discard', () => {
    form.clearDraft();
    editor.close();
  });
}

editor.addEventListener('cancel', event => {
  event.preventDefault();
  closeEditor();
});

function editProject(area, project = null) {
  dialogFrame(project ? 'Edit project' : 'New project', `<form id="project-form" data-area="${area}" data-id="${escape(project?.id ?? '')}">
    <label>Project name<input name="name" required autofocus value="${escape(project?.name ?? '')}"></label><p class="form-hint">${area}</p>
    <div class="dialog-actions">${project ? `<button class="danger" type="button" data-delete-project="${escape(project.id)}">Delete project</button>` : ''}
      <button class="primary" type="submit">${project ? 'Save changes' : 'Create project'}</button></div></form>`);
}

function confirmAction(title, description, label, action) {
  confirmDialog.innerHTML = `<div class="dialog-heading"><h2 id="confirm-title">${title}</h2></div><p>${description}</p>
    <div class="dialog-actions"><button class="secondary" type="button" autofocus>Cancel</button><button class="primary" type="button">${label}</button></div>`;
  confirmDialog.querySelector('.secondary').onclick = () => confirmDialog.close();
  confirmDialog.querySelector('.primary').onclick = () => {
    confirmDialog.close();
    action();
  };
  confirmDialog.showModal();
}

function finish(next, message) {
  if (!save(next)) return false;
  view = readView();
  editor.close();
  render();
  announce(message);
  return true;
}

function exportFile() {
  const url = URL.createObjectURL(new Blob([exportBackup(state)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `andies-hq-${clock.day}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

document.addEventListener('click', event => {
  if (!state) return;
  const button = event.target.closest('button');
  if (!button) return;
  const { view: key, edit, detail, toggle, projectNew, deleteTask, deleteProject, dateOffset, action } = button.dataset;
  if (key) go(key);
  else if (button.classList.contains('open-add')) taskForm();
  else if (dateOffset !== undefined) {
    const date = button.form.elements.due;
    date.value = offset(bangkokClock().day, Number(dateOffset));
    date.dispatchEvent(new Event('input', { bubbles: true }));
  }
  else if (projectNew) editProject(projectNew);
  else if (detail) taskDetail(state.tasks.find(task => task.id === detail));
  else if (edit) taskForm(state.tasks.find(task => task.id === edit));
  else if (toggle) {
    const task = state.tasks.find(task => task.id === toggle);
    const done = task.status === 'Done';
    finish({ ...state, tasks: state.tasks.map(item => item.id === toggle ? setStatus(item, done ? 'To Do' : 'Done') : item) },
      done ? 'Task reopened.' : 'Task completed.');
  } else if (deleteTask) {
    const form = $('#task-form');
    confirmAction('Delete this task?', 'This removes the task from all views.', 'Delete task', () => {
      if (finish({ ...state, tasks: state.tasks.filter(task => task.id !== deleteTask) }, 'Task deleted.')) form.clearDraft();
    });
  } else if (deleteProject) {
    const project = projectFor(deleteProject);
    confirmAction('Delete this project?', `Its tasks will move directly into ${project.area}.`, 'Delete project', () => {
      if (save(removeProject(state, deleteProject))) {
        editor.close();
        go(project.area);
        announce('Project deleted. Its tasks are still in ' + project.area + '.');
      }
    });
  } else if (action === 'close') closeEditor();
  else if (action === 'edit-project') {
    const project = projectFor(view.slice(8));
    editProject(project.area, project);
  } else if (action === 'export') exportFile();
  else if (action === 'import') $('#backup-file').click();
  else if (action === 'clear') {
    confirmAction('Clear sample data?', 'This removes example tasks, including edits to those tasks, and unused example projects.', 'Clear samples', () =>
      finish(clearSamples(state), 'Sample data cleared.'));
  }
});

document.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target;
  const fields = new FormData(form);
  const required = form.elements.title ?? form.elements.name;
  const name = required.value.trim();
  if (!name) {
    required.setCustomValidity('Enter a name or title.');
    required.reportValidity();
    return;
  }
  if (form.id === 'task-form') {
    const { values, notes } = form.details();
    const { title, area, project, status, due, dueTime, description } = values;
    const error = form.querySelector('.form-error');
    if (form.taskChangedElsewhere()) {
      error.textContent = 'This task changed in another tab. Close and reopen it before saving.';
      return;
    }
    if (dueTime && !due) {
      error.textContent = 'Choose a due date for this time.';
      form.elements.due.focus();
      return;
    }
    const changes = { title, area, project: project || null, status, due: due || null, dueTime: dueTime || null };
    if (!form.dataset.id || form.hasDescriptionChanges(description)) Object.assign(changes, { notes, description });
    try {
      const next = saveTask(state, changes, form.dataset.id);
      if (finish(next, form.dataset.id ? 'Task saved.' : `Added to ${area}.`)) form.clearDraft();
      else error.textContent = 'Could not save on this device. Your form is still open.';
    } catch (problem) {
      error.textContent = problem.message;
    }
  } else if (form.id === 'project-form') {
    const project = { id: form.dataset.id || crypto.randomUUID(), name, area: form.dataset.area };
    const projects = form.dataset.id ? state.projects.map(item => item.id === project.id ? project : item) : [...state.projects, project];
    finish({ ...state, projects }, form.dataset.id ? 'Project renamed.' : 'Project created.');
  }
});

document.addEventListener('input', event => {
  if (event.target.id === 'query') {
    query = event.target.value;
    $('#search-results').innerHTML = taskList(selectTasks(state, 'Search', clock.day, query));
  } else event.target.setCustomValidity?.('');
});

document.addEventListener('change', event => {
  const field = event.target;
  if (field.form?.id === 'task-form' && field.name === 'area') {
    field.form.elements.project.innerHTML = projectOptions(field.value, '');
  }
}, true);

document.addEventListener('change', async event => {
  const field = event.target;
  if (field.id === 'backup-file' && field.files.length) {
    const file = field.files[0];
    field.value = '';
    try {
      const next = readBackup(await file.text());
      confirmAction('Restore this backup?', 'This replaces your current tasks and projects with the contents of the selected backup.', 'Replace data', () =>
        finish(next, 'Backup restored.'));
    } catch (error) {
      announce(error instanceof SyntaxError ? 'Could not import. Choose a valid JSON file.' : error.message);
    }
  }
});

window.addEventListener('hashchange', () => {
  if (!state) return;
  const next = readView();
  if (view !== next) {
    view = next;
    render();
    window.scrollTo(0, 0);
  }
});

function refreshClock() {
  const previous = clock;
  clock = bangkokClock();
  if (!state) return;
  const changed = previous.day !== clock.day ||
    state.tasks.some(task => isOverdue(task, previous) !== isOverdue(task, clock));
  if (!changed) return;
  if (view === 'Search') $('#search-results').innerHTML = taskList(selectTasks(state, view, clock.day, query));
  else render();
}
document.addEventListener('visibilitychange', refreshClock);
setInterval(refreshClock, 1000);
window.addEventListener('storage', event => {
  if (event.key !== storageKey || event.newValue === null) return;
  try {
    state = readBackup(event.newValue);
    loadError = '';
    if (!editor.querySelector('#task-form') || !editor.open) {
      editor.close();
      confirmDialog.close();
    }
    view = readView();
    render();
  } catch {
    announce('Could not read the changes from another tab.');
  }
});

if (state) {
  view = readView();
  if (needsSave) save(state);
}
render();
