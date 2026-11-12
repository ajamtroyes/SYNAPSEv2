// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const byId = id => /** @type {HTMLElement} */ (document.getElementById(id));

  const log = byId('log');
  const status = byId('status');
  const ledger = byId('ledger');
  const mentions = byId('mentions');
  const prompt = /** @type {HTMLTextAreaElement} */ (byId('prompt'));
  const send = /** @type {HTMLButtonElement} */ (byId('send'));
  const stop = /** @type {HTMLButtonElement} */ (byId('stop'));

  const STATUS_TEXT = {
    running: 'Agent is working',
    reviewing: 'Waiting for your review',
    done: 'Finished',
    cancelled: 'Stopped. The workspace was restored.',
    failed: 'Failed. The workspace was restored.',
  };

  let messageBlock = null;
  let messageId = null;
  let activeMention = -1;
  let mentionResults = [];
  let mentionQuery = null;
  const toolEntries = new Map();

  function atBottom() {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  }

  function append(element) {
    const follow = atBottom();
    log.appendChild(element);
    if (follow) {
      log.scrollTop = log.scrollHeight;
    }
  }

  function entry(className, text) {
    const element = document.createElement('div');
    element.className = `entry ${className}`;
    element.textContent = text;
    append(element);
    return element;
  }

  function setRunning(isRunning) {
    send.hidden = isRunning;
    stop.hidden = !isRunning;
    prompt.disabled = isRunning;
  }

  function appendToken(event) {
    const follow = atBottom();
    if (messageId !== event.messageId) {
      messageId = event.messageId;
      messageBlock = document.createElement('div');
      messageBlock.className = event.threadId === 'main' ? 'entry assistant' : 'entry assistant subagent';
      log.appendChild(messageBlock);
    }
    messageBlock.textContent += event.text;
    if (follow) {
      log.scrollTop = log.scrollHeight;
    }
  }

  function summarizeArgs(call) {
    const args = call.args || {};
    return args.path || args.command || args.query || args.name || '';
  }

  function onRunEvent(event) {
    switch (event.type) {
      case 'status':
        status.textContent = event.detail ? `${STATUS_TEXT[event.status]}: ${event.detail}` : STATUS_TEXT[event.status];
        setRunning(event.status === 'running' || event.status === 'reviewing');
        if (event.status === 'failed' && event.detail) {
          entry('error', event.detail);
        }
        break;
      case 'session':
        entry('meta', `TrueForge session ${event.sessionId}, model ${event.model}`);
        break;
      case 'token':
        appendToken(event);
        break;
      case 'tool-call': {
        messageId = null;
        const scope = event.threadId === 'main' ? '' : '[subagent] ';
        const via = event.deferred ? ' (loaded on demand)' : '';
        const element = entry('tool', `${scope}${event.call.name} ${summarizeArgs(event.call)}${via}`);
        toolEntries.set(event.call.id, element);
        break;
      }
      case 'tool-result': {
        messageId = null;
        const element = toolEntries.get(event.toolCallId);
        if (element) {
          const details = document.createElement('details');
          const summary = document.createElement('summary');
          summary.textContent = 'Result';
          const body = document.createElement('pre');
          body.textContent = event.content;
          details.append(summary, body);
          element.appendChild(details);
        }
        break;
      }
      case 'thread-started':
        messageId = null;
        entry('meta', `Subagent started: ${event.title}`);
        break;
      case 'thread-finished':
        messageId = null;
        entry(event.error ? 'error' : 'meta', event.error ? `Subagent failed: ${event.title}: ${event.error}` : `Subagent finished: ${event.title}`);
        break;
      case 'compaction':
        entry('meta', event.phase === 'started' ? 'Compacting conversation history' : 'History compacted');
        break;
      case 'retry':
        entry('warning', `${event.model} failed (${event.reason}). Retrying, attempt ${event.attempt}, in ${event.delayMs} ms.`);
        break;
      case 'model-switch':
        entry('warning', `${event.from} failed (${event.reason}). Switching to ${event.to}.`);
        break;
      case 'rolled-back':
        if (event.report.restored.length > 0) {
          entry('meta', `Restored: ${event.report.restored.join(', ')}`);
        }
        if (event.report.conflicts.length > 0) {
          entry('error', `Left alone because you changed them: ${event.report.conflicts.join(', ')}`);
        }
        break;
    }
  }

  function renderLedger(data) {
    ledger.replaceChildren();
    ledger.hidden = false;
    const heading = document.createElement('h2');
    heading.textContent = `Context: ${data.usedTokens} of ${data.budgetTokens} tokens, ${data.entries.length} snippets from ${data.filesConsidered} files`;
    const list = document.createElement('ul');
    for (const item of data.entries) {
      const row = document.createElement('li');
      const path = document.createElement('code');
      path.textContent = `${item.path}:${item.lines}`;
      const why = document.createElement('span');
      why.className = 'why';
      why.textContent = ` ${item.tokens} tok. ${item.why}`;
      row.append(path, why);
      list.appendChild(row);
    }
    const wrapper = document.createElement('details');
    wrapper.open = true;
    const summary = document.createElement('summary');
    summary.appendChild(heading);
    wrapper.append(summary, list);
    if (data.omitted.length > 0) {
      const omitted = document.createElement('p');
      omitted.className = 'why';
      omitted.textContent = `Left out to stay in budget: ${data.omitted.map(item => item.path).join(', ')}`;
      wrapper.appendChild(omitted);
    }
    if (data.unresolved.length > 0) {
      const unresolved = document.createElement('p');
      unresolved.className = 'error';
      unresolved.textContent = `Could not resolve: ${data.unresolved.map(item => `@${item}`).join(', ')}`;
      wrapper.appendChild(unresolved);
    }
    ledger.appendChild(wrapper);
  }

  function closeMentions() {
    mentions.hidden = true;
    mentions.replaceChildren();
    prompt.setAttribute('aria-expanded', 'false');
    prompt.removeAttribute('aria-activedescendant');
    activeMention = -1;
    mentionResults = [];
    mentionQuery = null;
  }

  function highlightMention(index) {
    activeMention = index;
    [...mentions.children].forEach((item, position) => {
      item.setAttribute('aria-selected', String(position === index));
    });
    if (index >= 0) {
      prompt.setAttribute('aria-activedescendant', `mention-${index}`);
    }
  }

  function mentionAtCursor() {
    const before = prompt.value.slice(0, prompt.selectionStart);
    const match = /(^|[\s(])@([A-Za-z0-9_./-]*)$/.exec(before);
    return match ? { query: match[2], start: before.length - match[2].length } : null;
  }

  function acceptMention(index) {
    const chosen = mentionResults[index];
    const at = mentionAtCursor();
    if (!chosen || !at) {
      return;
    }
    const after = prompt.value.slice(prompt.selectionStart);
    prompt.value = `${prompt.value.slice(0, at.start)}${chosen.label} ${after}`;
    const caret = at.start + chosen.label.length + 1;
    prompt.setSelectionRange(caret, caret);
    closeMentions();
    prompt.focus();
  }

  function renderMentions(query, results) {
    if (query !== mentionQuery) {
      return;
    }
    mentionResults = results;
    mentions.replaceChildren();
    if (results.length === 0) {
      closeMentions();
      return;
    }
    results.forEach((result, index) => {
      const item = document.createElement('li');
      item.id = `mention-${index}`;
      item.setAttribute('role', 'option');
      item.textContent = result.label;
      const detail = document.createElement('span');
      detail.className = 'why';
      detail.textContent = ` ${result.detail}`;
      item.appendChild(detail);
      item.addEventListener('mousedown', event => {
        event.preventDefault();
        acceptMention(index);
      });
      mentions.appendChild(item);
    });
    mentions.hidden = false;
    prompt.setAttribute('aria-expanded', 'true');
    highlightMention(0);
  }

  function submit() {
    const text = prompt.value.trim();
    if (text === '' || prompt.disabled) {
      return;
    }
    closeMentions();
    vscode.postMessage({ type: 'submit', text });
    prompt.value = '';
  }

  byId('composer').addEventListener('submit', event => {
    event.preventDefault();
    submit();
  });

  prompt.addEventListener('input', () => {
    const at = mentionAtCursor();
    if (!at) {
      closeMentions();
      return;
    }
    mentionQuery = at.query;
    vscode.postMessage({ type: 'mentionQuery', query: at.query });
  });

  prompt.addEventListener('keydown', event => {
    const open = !mentions.hidden && mentionResults.length > 0;
    if (open && event.key === 'ArrowDown') {
      event.preventDefault();
      highlightMention((activeMention + 1) % mentionResults.length);
    } else if (open && event.key === 'ArrowUp') {
      event.preventDefault();
      highlightMention((activeMention - 1 + mentionResults.length) % mentionResults.length);
    } else if (open && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault();
      acceptMention(activeMention);
    } else if (open && event.key === 'Escape') {
      event.preventDefault();
      closeMentions();
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });

  stop.addEventListener('click', () => {
    vscode.postMessage({ type: 'cancel' });
  });
  byId('undo-last').addEventListener('click', () => {
    vscode.postMessage({ type: 'undoLast' });
  });
  byId('undo-run').addEventListener('click', () => {
    vscode.postMessage({ type: 'undoRun' });
  });
  byId('open-session').addEventListener('click', () => {
    vscode.postMessage({ type: 'openSession' });
  });

  window.addEventListener('message', ({ data }) => {
    switch (data.type) {
      case 'run-event':
        onRunEvent(data.event);
        break;
      case 'ledger':
        renderLedger(data.ledger);
        break;
      case 'user-message':
        messageId = null;
        entry('user', data.text);
        break;
      case 'notice':
        entry('meta', data.text);
        break;
      case 'mention-results':
        renderMentions(data.query, data.results);
        break;
    }
  });
})();
