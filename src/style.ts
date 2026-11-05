/** Panel CSS. Only the app's CSS custom properties, so it follows the theme. */
export const CSS = `
.pm { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; padding: 10px 12px 12px; font-size: 12.5px; color: var(--text); }
.pm * { box-sizing: border-box; }
.pm-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.pm-grow { flex: 1; min-width: 0; }
.pm-btn { height: 28px; padding: 0 12px; border-radius: var(--radius-sm, 6px); border: 1px solid var(--border-strong); background: var(--bg-800); color: var(--text); font: inherit; font-weight: 500; cursor: pointer; white-space: nowrap; transition: background var(--dur-fast, 120ms), border-color var(--dur-fast, 120ms); }
.pm-btn:hover { background: var(--bg-700); }
.pm-btn:focus-visible, .pm-in:focus-visible, .pm-sel:focus-visible, .pm-ta:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft); border-color: var(--accent); }
.pm-btn:disabled { opacity: .5; cursor: default; }
.pm-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); }
.pm-primary:hover { background: var(--accent-strong); }
.pm-danger { color: var(--danger); }
.pm-link { background: none; border: 0; padding: 0 2px; color: var(--text-muted); font: inherit; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.pm-link:hover { color: var(--text); }
.pm-switch { display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); cursor: pointer; user-select: none; }
.pm-switch input { appearance: none; width: 26px; height: 15px; border-radius: 99px; background: var(--bg-600); position: relative; margin: 0; cursor: pointer; transition: background var(--dur-fast, 120ms); }
.pm-switch input::after { content: ''; position: absolute; top: 2px; left: 2px; width: 11px; height: 11px; border-radius: 50%; background: var(--text); transition: transform var(--dur-fast, 120ms); }
.pm-switch input:checked { background: var(--accent); }
.pm-switch input:checked::after { transform: translateX(11px); background: var(--accent-contrast); }
.pm-clock { font-variant-numeric: tabular-nums; color: var(--text-muted); font-size: 11.5px; }
.pm-status { display: flex; flex-wrap: wrap; gap: 4px 10px; color: var(--text-muted); font-size: 11.5px; }
.pm-st { display: inline-flex; align-items: center; gap: 5px; }
.pm-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-faint); flex: none; }
.pm-dot[data-s=ok] { background: var(--ok); }
.pm-dot[data-s=busy] { background: var(--info); }
.pm-dot[data-s=warn] { background: var(--warn); }
.pm-dot[data-s=bad] { background: var(--danger); }
.pm-motion { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 8px; border-radius: var(--radius-md, 10px); background: var(--bg-850); border: 1px solid var(--border); }
.pm-meter { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.pm-meter-top { display: flex; justify-content: space-between; color: var(--text-muted); font-size: 11px; }
.pm-meter-top b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
.pm-bar { height: 4px; border-radius: 99px; background: var(--bg-700); overflow: hidden; }
.pm-bar i { display: block; height: 100%; width: 0; background: var(--accent); border-radius: inherit; transition: width var(--dur, 200ms); }
.pm-motion-note { grid-column: 1 / -1; color: var(--text-faint); font-size: 11px; }
.pm-scope { grid-column: 1 / -1; display: flex; flex-direction: column; margin-bottom: 2px; border-radius: var(--radius-sm, 6px); background: var(--bg-900); border: 1px solid var(--border); overflow: hidden; }
.pm-trace { display: block; width: 100%; height: 64px; }
.pm-voice { display: block; width: 100%; height: 40px; border-top: 1px solid var(--border); }
.pm-mv { display: inline-flex; align-items: center; gap: 3px; margin: 0 3px 0 0; padding: 0 6px; height: 17px; border-radius: 99px; vertical-align: middle; position: relative; top: -1px; font-size: 10.5px; line-height: 1; color: var(--accent-light); background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pm-mv b { font-weight: 650; }
.pm-mv small { font-size: 10px; opacity: .75; }
.pm-mv svg { flex: none; display: block; }
.pm-mv-bar { display: inline-block; width: 22px; height: 4px; margin-left: 3px; border-radius: 99px; background: color-mix(in srgb, currentColor 22%, transparent); overflow: hidden; }
.pm-mv-bar i { display: block; height: 100%; border-radius: inherit; background: currentColor; }
.pm-mv[data-heat=cool] { color: color-mix(in srgb, var(--accent-light) 70%, var(--text-muted)); background: color-mix(in srgb, var(--accent-soft) 60%, transparent); }
.pm-mv[data-heat=warm] { color: var(--accent-light); }
.pm-mv[data-heat=hot] { color: #fff; background: color-mix(in srgb, #ff2d95 45%, transparent); border-color: #ff2d95; box-shadow: 0 0 8px rgba(255, 45, 149, .65), 0 0 16px rgba(255, 45, 149, .3); }
.pm-mv[data-kind=edge] { color: #e9dcff; background: color-mix(in srgb, #8a3cff 35%, transparent); border-color: #8a3cff; box-shadow: 0 0 8px rgba(138, 60, 255, .7), 0 0 16px rgba(138, 60, 255, .3); }
.pm-mv[data-kind=more] { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); border-color: color-mix(in srgb, var(--ok) 40%, transparent); }
.pm-mv[data-kind=play] { color: var(--text); background: color-mix(in srgb, var(--info) 18%, transparent); border-color: color-mix(in srgb, var(--info) 45%, transparent); }
.pm-mv[data-kind=stop] { color: var(--text-muted); background: var(--bg-700); border-color: var(--border-strong); }
.pm-mv[data-lost] { opacity: .45; text-decoration: line-through; box-shadow: none; }

.pm-mic { width: 34px; padding: 0; display: inline-flex; align-items: center; justify-content: center; color: var(--text-muted); touch-action: none; user-select: none; }
.pm-mic:hover { color: var(--text); }
.pm-mic[data-state=recording], .pm-mic[data-state=opening] { color: #fff; background: var(--danger); border-color: var(--danger); box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 30%, transparent); animation: pm-rec 1.2s ease-in-out infinite; }
.pm-mic[data-state=transcribing], .pm-mic[data-state=installing] { color: var(--accent-light); border-color: var(--accent); }
.pm-ears { min-height: 15px; font-size: 11px; color: var(--text-faint); padding: 0 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pm-ears[data-tone=rec] { color: var(--danger); }
.pm-ears[data-tone=busy] { color: var(--info); }
.pm-ears[data-tone=warn] { color: var(--warn); white-space: normal; }
.pm-ears[data-tone=bad] { color: var(--danger); white-space: normal; }
@keyframes pm-rec { 0%, 100% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--danger) 35%, transparent); } 50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--danger) 15%, transparent); } }

.pm-suggest { flex-wrap: wrap; gap: 4px; }
.pm-vchip { height: 22px; padding: 0 9px; border-radius: 99px; border: 1px solid var(--border-strong); background: var(--bg-850); color: var(--text-muted); font: inherit; font-size: 11.5px; cursor: pointer; white-space: nowrap; }
.pm-vchip:hover { color: var(--text); background: var(--bg-700); }
.pm-vchip[aria-pressed=true] { color: var(--accent-light); border-color: var(--accent); background: var(--accent-soft); }

/* Sound tags and heated speech: pale text in a coloured neon halo, each kind
   with its own colour and movement. */
.pm-sfx { --fx: var(--accent); display: inline-block; margin: 0 4px 0 0; font-style: italic; font-size: 12px; letter-spacing: .02em; white-space: pre; color: color-mix(in srgb, var(--text) 82%, var(--fx)); text-shadow: 0 0 3px color-mix(in srgb, var(--fx) 70%, transparent), 0 0 10px var(--fx), 0 0 20px var(--fx), 0 0 32px color-mix(in srgb, var(--fx) 60%, transparent); }
.pm-sfx > span { display: inline-block; }
.pm-sfx[data-fx=moan] { --fx: #ff2d95; color: #ff7cc0; }
.pm-sfx[data-fx=moan] > span { animation: pm-sway-y 2.6s ease-in-out infinite; animation-delay: calc(var(--i) * -.14s); }
.pm-sfx[data-fx=purr] { --fx: #a347ff; color: #cfa6ff; }
.pm-sfx[data-fx=purr] > span { animation: pm-sway-y 3.2s ease-in-out infinite; animation-delay: calc(var(--i) * -.18s); }
.pm-sfx[data-fx=whisper] { --fx: #8a3cff; font-size: 11px; letter-spacing: .1em; animation: pm-ghost 3.4s ease-in-out infinite alternate; }
.pm-sfx[data-fx=growl] { --fx: #ff2a2a; font-weight: 700; font-style: normal; letter-spacing: .05em; }
.pm-sfx[data-fx=growl] > span { animation: pm-twitch .32s steps(1) infinite; animation-delay: calc(var(--i) * -.07s); }
.pm-sfx[data-fx=whimper] { --fx: #9b7bff; }
.pm-sfx[data-fx=whimper] > span { animation: pm-tremble .22s ease-in-out infinite alternate; animation-delay: calc(var(--i) * -.05s); }
.pm-sfx[data-fx=breath] { --fx: #ff4fb8; animation: pm-orbit 4s linear infinite; }
.pm-sfx[data-fx=laugh] { --fx: #ffb000; font-style: normal; }
.pm-sfx[data-fx=laugh] > span { animation: pm-bounce .7s ease-in-out infinite; animation-delay: calc(var(--i) * -.06s); }
.pm-sfx[data-fx=sigh] { --fx: #7c8db5; animation: pm-sway 4.5s ease-in-out infinite; }
.pm-sfx[data-fx=snort] { --fx: #c9a0ff; font-style: normal; animation: pm-snort 2.4s ease-in-out infinite; }

.pm-heat[data-heat=hot] { color: color-mix(in srgb, var(--text) 78%, #ff9ccf); text-shadow: 0 0 3px rgba(255, 45, 149, .8), 0 0 10px rgba(255, 45, 149, .9), 0 0 20px rgba(255, 45, 149, .7), 0 0 32px rgba(255, 45, 149, .4); }
.pm-heat[data-heat=hot] > span { display: inline-block; animation: pm-jolt 2.6s steps(1) infinite; animation-delay: calc(var(--i) * -.37s); }
.pm-heat[data-heat=held] { color: color-mix(in srgb, var(--text) 72%, #c9a0ff); text-shadow: 0 0 3px rgba(138, 60, 255, .8), 0 0 10px rgba(138, 60, 255, .95), 0 0 22px rgba(138, 60, 255, .75), 0 0 34px rgba(138, 60, 255, .45); animation: pm-ghost 2.8s ease-in-out infinite alternate; }

/* Only the latest lines move; older ones settle. */
.pm-msg:not(:nth-last-child(-n+4)) .pm-sfx, .pm-msg:not(:nth-last-child(-n+4)) .pm-sfx > span, .pm-msg:not(:nth-last-child(-n+4)) .pm-heat, .pm-msg:not(:nth-last-child(-n+4)) .pm-heat > span { animation: none; }
@keyframes pm-sway-y { 0%, 100% { transform: translateY(.5px); } 50% { transform: translateY(-1.2px); } }
@keyframes pm-wave { 0%, 100% { transform: translateY(1px); } 50% { transform: translateY(-2.5px); } }
@keyframes pm-ghost { 0%, 55% { opacity: 1; } 100% { opacity: .3; } }
@keyframes pm-twitch { 0% { transform: translate(0, 0); } 25% { transform: translate(.9px, -.7px); } 50% { transform: translate(-.8px, .6px); } 75% { transform: translate(.6px, .8px); } }
@keyframes pm-jolt { 0% { transform: translateY(-1px); } 2% { transform: translateY(0); } 9% { transform: translateY(1.5px); } 10% { transform: translateY(0); } 56% { transform: translateX(.8px); } 57% { transform: translateX(0); } }
@keyframes pm-tremble { from { transform: translateX(-.5px); } to { transform: translateX(.5px); } }
@keyframes pm-orbit {
  0% { text-shadow: 0 0 10px rgba(255, 79, 184, .5), -6px -1px 6px rgba(255, 176, 0, 0), 6px 1px 6px rgba(80, 180, 255, 0); }
  30% { text-shadow: 0 0 12px rgba(255, 79, 184, .7), -4px -1px 4px rgba(255, 176, 0, .35), 4px 1px 4px rgba(80, 180, 255, .45); }
  60% { text-shadow: 0 0 12px rgba(255, 79, 184, .7), 4px -1px 4px rgba(255, 176, 0, .35), -4px 1px 4px rgba(80, 180, 255, .45); }
  100% { text-shadow: 0 0 10px rgba(255, 79, 184, .5), 6px -1px 6px rgba(255, 176, 0, 0), -6px 1px 6px rgba(80, 180, 255, 0); }
}
@keyframes pm-bounce { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(-3px); } }
@keyframes pm-sway { 0%, 100% { transform: rotate(1.5deg); } 50% { transform: rotate(-1.5deg); } }
@keyframes pm-snort { 0%, 88%, 100% { transform: translateX(0); } 91% { transform: translateX(-1.5px); } 94% { transform: translateX(1.5px); } }
@media (prefers-reduced-motion: reduce) { .pm-sfx, .pm-sfx > span, .pm-heat, .pm-heat > span { animation: none !important; } }
/* A scroll box clips at its edges, glow and all: pad it so the glows fade out inside it, and pull it out by the same amount so the text stays put. */
.pm-log { flex: 1; min-height: 120px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 10px 12px 14px; margin: -8px -12px -6px; scrollbar-gutter: stable; }
.pm-msg { line-height: 1.45; overflow-wrap: anywhere; }
.pm-msg-who { font-size: 10.5px; font-weight: 600; letter-spacing: .02em; color: var(--text-faint); margin-right: 5px; text-transform: uppercase; }
.pm-msg[data-who=you] { align-self: flex-end; max-width: 88%; padding: 5px 9px; border-radius: var(--radius-md, 10px); background: var(--accent-soft); }
.pm-msg[data-who=you] .pm-msg-who { display: none; }
.pm-msg[data-who=sys] { color: var(--text-faint); font-size: 11.5px; text-align: center; }
.pm-msg[data-error] { color: var(--danger); }
.pm-msg[data-old] { opacity: .55; }
.pm-msg[data-pending]::after { content: '…'; color: var(--text-faint); }
.pm-chip { display: inline-block; margin: 0 3px 0 0; padding: 0 5px; border-radius: var(--radius-xs, 4px); font-size: 10.5px; line-height: 16px; vertical-align: 1px; background: var(--bg-700); color: var(--text-muted); font-family: ui-monospace, monospace; }
.pm-chip[data-k=move] { background: var(--accent-soft); color: var(--accent-light); }
.pm-chip[data-k=lost] { text-decoration: line-through; }
.pm-chip[data-k=unknown] { opacity: .7; text-decoration: line-through; }
.pm-chip[data-k=sound] { background: transparent; border: 1px solid var(--border-strong); font-style: italic; font-family: inherit; }
.pm-empty { margin: auto; text-align: center; color: var(--text-faint); font-size: 12px; padding: 16px 8px; line-height: 1.5; }
.pm-in { flex: 1; min-width: 0; height: 30px; padding: 0 10px; border-radius: var(--radius-sm, 6px); border: 1px solid var(--border-strong); background: var(--bg-900); color: var(--text); font: inherit; outline: none; }
.pm-in::placeholder { color: var(--text-faint); }

.pm-view { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; }
.pm-scroll { overflow-y: auto; padding-right: 2px; }
.pm-sm { height: 24px; padding: 0 8px; font-size: 11.5px; }
.pm-sel { height: 28px; min-width: 0; padding: 0 6px; border-radius: var(--radius-sm, 6px); border: 1px solid var(--border-strong); background: var(--bg-900); color: var(--text); font: inherit; outline: none; }
.pm-foot { font-size: 11.5px; gap: 10px; }
.pm-title { font-weight: 600; text-align: center; }
.pm-sec { display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: var(--radius-md, 10px); background: var(--bg-850); border: 1px solid var(--border); }
.pm-label { font-weight: 600; font-size: 12px; }
.pm-note { color: var(--text-faint); font-size: 11.5px; line-height: 1.4; overflow-wrap: anywhere; }
.pm-bad { color: var(--danger); }
.pm-field { display: grid; grid-template-columns: 64px 1fr; align-items: center; gap: 6px; color: var(--text-muted); font-size: 11.5px; }
.pm-ta { width: 100%; resize: vertical; padding: 7px 9px; border-radius: var(--radius-sm, 6px); border: 1px solid var(--border-strong); background: var(--bg-900); color: var(--text); font: inherit; font-size: 12px; line-height: 1.5; outline: none; }
.pm-results { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto; }
.pm-results:empty { display: none; }
.pm-result { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: var(--radius-sm, 6px); background: var(--bg-800); }
.pm-result-title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`
