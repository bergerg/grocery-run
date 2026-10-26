"use strict";
// UI strings. Hebrew is the default; the viewer's choice is remembered on this device.
// Values are strings with {placeholders}, or functions for plurals.
const I18N = {
  he: {
    dir: "rtl",
    title: "השלמות סופר",
    brand_html: "השלמות<br>סופר<span>.</span>",
    lede: "רשימת קניות אחת לכל הבית. מסמנים מוצר בסופר, והוא מתעדכן אצל כולם בטלפון.",
    signin: "כניסה עם Google",
    language: "שפה",
    household_btn: "רשימה",
    connecting: "מתחבר…",
    reconnecting: "מתחבר מחדש…",
    no_household: "עדיין אין רשימה",
    start_title: "יוצרים רשימה",
    start_body: "אפשר ליצור רשימה חדשה, או להצטרף עם הקוד בן 10 התווים שקיבלתם.",
    setup_btn: "הגדרת רשימה",
    to_buy: "לקנות",
    in_cart: "בעגלה",
    clear: "ניקוי",
    empty_title: "הכול במלאי",
    empty_body: "מה נגמר? אפשר להוסיף למטה.",
    add_ph: "מה להוסיף? למשל: חלב",
    qty_ph: "כמות",
    item_aria: "מוצר",
    qty_aria: "כמות",
    add_btn: "הוספה",
    close: "סגירה",
    sheet_title: "רשימת השלמות",
    invite_code: "קוד הזמנה",
    invite_help: "שלחו את הקישור או את הקוד. אחרי כניסה עם Google הם יגיעו ישר לרשימה הזו.",
    copy_link: "העתקת קישור הזמנה",
    new_code: "קוד חדש",
    new_code_confirm: "הקוד הישן יפסיק לעבוד. הקישו שוב",
    your_households: "הרשימות שלך",
    current: "נוכחי",
    agent_access: "גישה לסוכן",
    agent_help: "אפשר לתת לעוזר דיגיטלי (MCP או API) לקרוא ולהוסיף לרשימה בשמך. כל טוקן עובד רק עבור הרשימה הזו, ומפסיק לעבוד אם יוצאים ממנה.",
    token_ph: "למשל: הסוכן בוואטסאפ",
    create_token: "יצירת טוקן",
    copy_now: "העתיקו עכשיו. הטוקן לא יוצג שוב",
    token: "טוקן",
    mcp_url: "כתובת MCP",
    token_header_html: 'שלחו את הטוקן בכותרת <code dir="ltr">Authorization: Bearer &lt;token&gt;</code>.',
    copy_token: "העתקת טוקן",
    copy_mcp: "העתקת כתובת MCP",
    revoke: "ביטול",
    revoke_confirm: "הקישו לאישור",
    join_title: "הצטרפות עם קוד",
    join_btn: "הצטרפות",
    create_title: "יצירת רשימה חדשה",
    create_ph: "למשל: שופרסל",
    create_btn: "יצירה",
    default_home: "רשימת השלמה",
    list_fallback: "רשימה",
    leave: "יציאה מהרשימה",
    leave_confirm: "הקישו שוב כדי לצאת",
    signout: "התנתקות",
    joined: "הצטרפת לרשימה",
    created: "הרשימה {name} נוצרה",
    rotated: "נוצר קוד הזמנה חדש",
    link_copied: "קישור ההזמנה הועתק",
    link_selected: "הקישור סומן. העתיקו אותו כדי לשתף",
    token_revoked: "הטוקן בוטל",
    copied: "{label} הועתק",
    select_copy: "סמנו את הטקסט והעתיקו",
    cleared: n => n === 1 ? "פריט אחד נוקה" : `${n} פריטים נוקו`,
    count: (todo, m) => `${todo} לקנות · ${m === 1 ? "חבר אחד" : `${m} חברים`}`,
    via_agent: "{name} דרך הסוכן",
    check_aria: "סימון {name}",
    uncheck_aria: "ביטול סימון {name}",
    remove_aria: "הסרת {name}",
    never_used: "עוד לא היה בשימוש",
    used_now: "בשימוש ממש עכשיו",
    used_min: "בשימוש לפני {n} דק׳",
    used_h: "בשימוש לפני {n} שע׳",
    used_d: n => n === 1 ? "בשימוש אתמול" : `בשימוש לפני ${n} ימים`,
    err_code_format: "קוד הזמנה מורכב מ־10 אותיות ומספרים.",
    err_code_nomatch: "הקוד לא תואם לאף רשימה. בדקו אותו ונסו שוב.",
    err_too_many: "יותר מדי קודים שגויים. נסו שוב בעוד שעה.",
    err_max_households: "אפשר ליצור עד 20 רשימות.",
    err_max_items: "ברשימה כבר 500 פריטים. נקו חלק לפני שמוסיפים עוד.",
    err_max_tokens: "אפשר להחזיק עד 10 טוקנים. בטלו אחד קודם.",
    err_not_member: "אין לך גישה לרשימה הזה.",
    err_network: "אין חיבור. בדקו את האינטרנט ונסו שוב.",
  },
  en: {
    dir: "ltr",
    title: "Pantry Run",
    brand_html: "Pantry<br>Run<span>.</span>",
    lede: "One grocery list for the whole household. Tick something off at the store and it disappears from everyone's phone.",
    signin: "Continue with Google",
    language: "Language",
    household_btn: "Household",
    connecting: "Connecting",
    reconnecting: "Reconnecting…",
    no_household: "No household yet",
    start_title: "Start a household",
    start_body: "Create one, or join with the 10-character code someone sent you.",
    setup_btn: "Set up household",
    to_buy: "To buy",
    in_cart: "In the cart",
    clear: "Clear",
    empty_title: "All stocked up",
    empty_body: "Add the first thing you're out of below.",
    add_ph: "Add an item, e.g. oat milk",
    qty_ph: "Qty",
    item_aria: "Item",
    qty_aria: "Quantity",
    add_btn: "Add",
    close: "Done",
    sheet_title: "Household",
    invite_code: "Invite code",
    invite_help: "Send this link, or the code. They sign in with Google and land on this list.",
    copy_link: "Copy invite link",
    new_code: "New code",
    new_code_confirm: "Old code stops working. Tap again",
    your_households: "Your households",
    current: "Current",
    agent_access: "Agent access",
    agent_help: "Let an assistant (MCP or API) read and add to this list on your behalf. Each token works for this household only, and stops working if you leave it.",
    token_ph: "e.g. WhatsApp agent",
    create_token: "Create token",
    copy_now: "Copy now. It won't be shown again",
    token: "Token",
    mcp_url: "MCP URL",
    token_header_html: 'Send the token as the header <code dir="ltr">Authorization: Bearer &lt;token&gt;</code>.',
    copy_token: "Copy token",
    copy_mcp: "Copy MCP URL",
    revoke: "Revoke",
    revoke_confirm: "Tap to confirm",
    join_title: "Join with a code",
    join_btn: "Join",
    create_title: "Create a new one",
    create_ph: "e.g. Home",
    create_btn: "Create",
    default_home: "Home",
    list_fallback: "List",
    leave: "Leave household",
    leave_confirm: "Tap again to leave",
    signout: "Sign out",
    joined: "Joined household",
    created: "Created {name}",
    rotated: "New invite code made",
    link_copied: "Invite link copied",
    link_selected: "Link selected. Copy it to share",
    token_revoked: "Token revoked",
    copied: "{label} copied",
    select_copy: "Select the text and copy it",
    cleared: n => `Cleared ${n} item${n === 1 ? "" : "s"}`,
    count: (todo, m) => `${todo} to buy · ${m} member${m === 1 ? "" : "s"}`,
    via_agent: "{name} via agent",
    check_aria: "Check off {name}",
    uncheck_aria: "Uncheck {name}",
    remove_aria: "Remove {name}",
    never_used: "never used",
    used_now: "used just now",
    used_min: "used {n} min ago",
    used_h: "used {n} h ago",
    used_d: n => `used ${n} d ago`,
    err_code_format: "Invite codes are 10 letters and numbers.",
    err_code_nomatch: "That code didn't match a household. Check it and try again.",
    err_too_many: "Too many wrong codes. Try again in an hour.",
    err_max_households: "You can create up to 20 households.",
    err_max_items: "This list has 500 items. Clear some before adding more.",
    err_max_tokens: "You can have up to 10 agent tokens. Revoke one first.",
    err_not_member: "You're no longer a member of this household.",
    err_network: "No connection. Check your internet and try again.",
  },
};

let LANG = (() => {
  try { const s = localStorage.getItem("lang"); if (s && I18N[s]) return s; } catch {}
  return "he";
})();

function t(key, vars = {}) {
  const v = I18N[LANG][key] ?? I18N.en[key] ?? key;
  if (typeof v === "function") return v(...(Array.isArray(vars) ? vars : [vars]));
  return String(v).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

// Server raises English messages; show them in the viewer's language.
const SERVER_ERRORS = [
  [/too many wrong codes/i, "err_too_many"],
  [/up to 20 households/i, "err_max_households"],
  [/500 items/i, "err_max_items"],
  [/up to 10 agent tokens/i, "err_max_tokens"],
  [/not a member|row-level security/i, "err_not_member"],
  [/failed to fetch|network/i, "err_network"],
];
function tErr(err) {
  const msg = err?.message || String(err || "");
  for (const [re, key] of SERVER_ERRORS) if (re.test(msg)) return t(key);
  return msg;
}

function applyStaticI18n() {
  const d = I18N[LANG];
  document.documentElement.lang = LANG;
  document.documentElement.dir = d.dir;
  document.title = d.title;
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-html]").forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll("[data-i18n-aria]").forEach(el => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
  document.querySelectorAll("[data-lang]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lang === LANG)));
}

function setLang(lang) {
  if (!I18N[lang] || lang === LANG) return;
  LANG = lang;
  try { localStorage.setItem("lang", lang); } catch {}
  applyStaticI18n();
  document.dispatchEvent(new CustomEvent("langchange"));
}

applyStaticI18n();
document.addEventListener("click", e => { const b = e.target.closest("[data-lang]"); if (b) setLang(b.dataset.lang); });
