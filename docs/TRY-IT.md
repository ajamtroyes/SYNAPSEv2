# Try Synapse: a step-by-step guide for beginners

This takes about 20 minutes the first time. You do not need an AI account or API key: a practice "fake" AI is
included. Copy each command exactly, press Enter, and wait until it finishes before typing the next one.

## 1. Install four programs (once)

Download and install each one, keeping the default options:

1. **Git**: <https://git-scm.com/downloads>. On Windows this also installs **Git Bash**, which you will use.
2. **Node.js**, the version marked "LTS": <https://nodejs.org>
3. **Python 3**: <https://www.python.org/downloads>. On Windows, tick **"Add Python to PATH"** during installation.
4. **VS Code**: <https://code.visualstudio.com>

Restart your computer afterwards.

## 2. Download the project (once)

1. Open **Git Bash** on Windows, or **Terminal** on Mac.
2. Copy this command, then paste it with right click and press Enter:

   ```bash
   git clone https://github.com/ajamtroyes/SYNAPSEv2.git
   ```

3. Go into the project folder:

   ```bash
   cd SYNAPSEv2
   ```

4. Install what the project needs. This takes a few minutes:

   ```bash
   npm ci
   ```

5. Download the Flask project used in the competition:

   ```bash
   npm run demo:flask -- setup
   ```

## 3. Start the helpers (every time you try it)

You need **three** terminal windows open at the same time. Open each one in the `SYNAPSEv2` folder: open Git Bash or
Terminal, then type `cd SYNAPSEv2`.

**Terminal 1.** Starts TrueForge, the engine that runs the AI. Leave it open.

```bash
npm run trueforge
```

Wait until the text stops scrolling.

**Terminal 2.** Starts the practice AI. Leave it open.

```bash
npm run mock-model
```

**Terminal 3.** Connects the practice AI to TrueForge:

```bash
npm run setup:models -- --config agent/models.mock.example.json
```

## 4. Open the project in VS Code

1. Open VS Code. Choose **File, then Open Folder**, and pick the `SYNAPSEv2` folder.
2. Press **F5**. A second VS Code window opens, showing the Flask project.
3. In that second window, open the settings: press **Ctrl+,** (or **Cmd+,** on Mac).
4. Search for `synapse.models`, click **Edit in settings.json**, and make that line read:

   ```json
   "synapse.models": ["mock/scripted"]
   ```

5. Save with **Ctrl+S**.

## 5. Try it

All of this happens in the **second** VS Code window.

**Inline edit:**

1. Open `src/flask/helpers.py` from the file list on the left.
2. Select a few lines of code with the mouse.
3. Press **Ctrl+Alt+K** (or **Cmd+Alt+K** on Mac), type any instruction, and press Enter.
4. A tab named **Review · helpers.py** opens. Click **Accept** or **Reject** above the change.

**The agent panel:**

1. Click the Synapse icon, three connected dots, in the bar on the far left.
2. Type a message at the bottom and press Enter. The answer appears word by word.
3. Try the **Stop**, **Undo last change** and **Open session in TrueForge** buttons.

The practice AI always gives the same simple answer. That is normal: it is only for checking that everything works.

## If something goes wrong

- **"Cannot reach TrueForge":** Terminal 1 was closed. Start it again.
- **Anything else:** press **Ctrl+Shift+P** in the second window, type `Synapse: Check TrueForge Setup`, and press Enter.
  It says what is wrong.
- **To start again from a clean Flask project:** run `npm run demo:flask -- reset` in a terminal.
- **To stop everything:** close the second VS Code window, and press **Ctrl+C** in each terminal.
