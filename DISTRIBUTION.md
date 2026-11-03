# Interview Copilot — Installation & User Guide

A desktop AI assistant for technical interviews. Captures audio, transcribes,
suggests answers via Claude, and can auto-type into any focused window.
Invisible to screen share.

---

## 1. Install

1. Download **`Interview Copilot Setup.exe`**.
2. Run it. If Windows shows **"Windows protected your PC"**:
   - Click **More info** (top-left of the dialog).
   - Click **Run anyway**.
   (The installer isn't code-signed yet — that's the only reason for the
   warning. Nothing in the app phones home or collects data.)
3. The app installs and launches automatically.

The app installs to `%LOCALAPPDATA%\interview-copilot` and is removable via
**Settings → Apps → Installed apps**.

---

## 2. Configure (one-time)

The Settings window opens automatically on first launch. You need:

| Field | How to get it | Cost |
|---|---|---|
| **Anthropic API Key** | [console.anthropic.com](https://console.anthropic.com) → API Keys | Pay-as-you-go (~$0.01–0.05 per question with Haiku) |
| **Groq API Key** | [console.groq.com](https://console.groq.com) → API Keys | **Free tier** covers most use |
| **Candidate profile (CV)** | Paste your résumé / background | — |
| **Target job description** | Paste the JD for the role | — |
| **Example Q&A** *(optional but recommended)* | Paste 5–10 example answers to anchor the AI's style | — |

Click **Test keys** to confirm both are valid, then **Save**.

---

## 3. Audio routing (for live video calls)

To capture the interviewer's voice from Zoom/Meet/Teams, install **VB-Cable**
(free virtual audio cable):

1. Download from [vb-audio.com/Cable](https://vb-audio.com/Cable/) → run installer → reboot.
2. Windows **Sound settings** → set:
   - **Output**: `CABLE Input` (so the video call audio goes into the cable)
   - **Input**: `CABLE Output` (so the app reads from the cable)
3. To still hear the call yourself: right-click `CABLE Input` → Properties → **Listen** tab → check "Listen to this device" → select your headphones.
4. In **Interview Copilot → Settings → Audio input device** → pick `CABLE Output`.

If you only want to test with your own voice into your mic, set Input back to
your regular mic and skip the cable setup.

---

## 4. Hotkeys

All hotkeys are **global** — they work even when Interview Copilot is in the
background.

| Hotkey | Action |
|---|---|
| `Ctrl+Shift+H` | Hide / show overlay |
| `Ctrl+Shift+R` | Generate answer (manual mode) / regenerate |
| `Ctrl+Shift+C` | Copy last suggested answer |
| `Ctrl+Shift+K` | Open the Live Coding window |
| `Ctrl+Shift+S` | Capture screen into Live Coding (press multiple times for multi-page problems) |
| `Ctrl+Shift+T` | Auto-type the last code response into the focused window |

---

## 5. Recommended settings for live interviews

In **Settings → Behavior**:

- **When to generate the answer**: **Manual** — gives you full control. The
  interviewer's "okay, thank you" never wipes your answer.
- **Answer length**: **Concise** — short core answer + reserve bullets if
  they probe. Reads more naturally when speaking live.
- **Show Portuguese translation**: **OFF** — faster and cleaner if you're
  comfortable in English.

In **Settings → Auto-typer**:

- **Typing speed**: **Medium** (≈70ms/char) is a good default.
- **Countdown**: **3 seconds** is usually enough to click into the target field.

---

## 6. Privacy & security

- API keys are stored encrypted via the OS keychain (Windows Credential
  Manager / macOS Keychain). They never leave your machine.
- Audio is sent to **Groq** for transcription and **Anthropic** for response
  generation. Nothing else is uploaded.
- Session logs (Q&A transcripts) are stored locally in
  `%APPDATA%\interview-copilot\session-logs\` as JSONL. Open via
  **Settings → Open logs folder**. Delete them whenever you want.

---

## 7. Known caveats

- **Anti-cheat detection**: some assessment platforms can flag pasted text,
  excessive tab switching, or other anomalies. The auto-typer simulates
  human-like typing to bypass paste detection but no system is 100% safe.
- **Antivirus false positives**: rare, but some AV products flag Electron
  apps that simulate keyboard input. If it does, add an exclusion.
- **Screen content protection**: works on Windows 10/11 and recent macOS. The
  app window won't appear in screen shares, but other monitoring tools (some
  enterprise software, OBS scene-grabbers) may still see it. Test before
  relying on it.

---

## 8. Updating

### Recruiter screening preparation

Use **Preparação RH / Técnica** to review screening and technical questions in English and
Portuguese. Prepared answers are stored in local settings; reviewing them does
not use audio or API credits. **Praticar esta pergunta com IA** generates an
answer using the saved CV and recruiter context.

Choose **Perguntas de RH** or **Perguntas técnicas** inside preparation. Practicing
a question selects the matching interview style, so technical practice uses the
technical examples and recruiter practice uses HR examples. Live Coding follows
the problem's explicit language; otherwise it uses the current role rather than
defaulting to the candidate's historical primary stack.

With **Conversational + Concise**, live answers use short spoken sentences,
ordinary verbs and natural contractions. Technical answers normally stay within
45 words; extra examples and reserve notes wait for a follow-up. Formal tone
remains polite and plain. Career claims still require confirmed profile facts.

In **Settings → Preparação para a recrutadora**, confirm current employment,
start date, weekly availability and the facts already shared with the recruiter.
**Ativar preparação RH** selects short English answers, Portuguese translation
and manual generation. Click **Save** after editing Settings.

The live view keeps the original question and Portuguese translation visible
above the answer, with independent scrolling. Use **A− / A+** to resize the
answer text. In manual mode, translation appears on capture; generate the
answer using the button or **Ctrl+Shift+R**. Missing logistics are left unknown
instead of inventing a notice period, weekly schedule or salary.

Currently manual: download the new `Setup.exe` and run it — it upgrades in
place. Settings and session logs are preserved across updates.

---

## 9. Uninstall

Windows **Settings → Apps → Installed apps → Interview Copilot → Uninstall**.

The app data (settings, encrypted keys, session logs) lives in
`%APPDATA%\interview-copilot\` — delete that folder if you want a fully
clean removal.

---

*Questions or issues — contact Luiz Gustavo.*
