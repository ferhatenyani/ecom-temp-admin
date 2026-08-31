/**
 * The country list, in French and Arabic, and the only place in the panel that
 * knows what a two-letter code is called.
 *
 * No dependencies, for `lib/geography.ts`'s and `lib/shipment-status.ts`'s
 * reason: a client component imports a value from here without dragging Zod or
 * a server module into the browser bundle behind it.
 *
 * ## This file exists because a decision was reversed, and the old argument was
 * ## not wrong — it was answering a different question
 *
 * `AddressFields.tsx` used to say, at length, that the country control could
 * only be a text box:
 *
 * > *"The panel cannot close that hole and must not pretend to. A picker would
 * > need a 249-row country table nobody here has measured, and `docs/API.md` and
 * > `lib/api/schemas` are built on what the API returns rather than on a list
 * > typed from memory."*
 *
 * Every clause of that is still true. The API validates a country by **shape
 * alone** — `Commerce\AddressInput::validateCountry()` is `preg_match('/^[A-Z]{2}$/')`
 * and nothing more, read from source — so `ZZ` is accepted with a 200, measured
 * in-process via `rest_do_request()` and recorded in `BLOCKED.md`'s table. The
 * API therefore cannot supply this list, and a list the panel invents is a list
 * the panel is answerable for.
 *
 * **What changed is that the panel was told to be answerable for it.** The
 * carried-forward decision is *"a dropdown of real countries, Algeria
 * pre-selected"*, and the reason is the half of the old paragraph that was never
 * argued: leaving the box free-text does not avoid inventing a list, it moves
 * the list into the operator's head, where it is 249 rows long, unversioned, and
 * differently wrong on every shift. A shop that stores `AL` for *Algérie* has a
 * parcel that will not route, and nothing in the stack objects.
 *
 * So the table is written down. What the old argument correctly demanded is that
 * it not be **typed from memory**, and it is not — see below.
 *
 * ## `Intl.DisplayNames` at runtime, and why the answer is *no*
 *
 * The obvious shape is two lines: `new Intl.DisplayNames([locale], {type:"region"})`
 * over a list of codes, sorted with `Intl.Collator(locale)`. It was the first
 * draft and it is rejected on three counts, in ascending order of how badly it
 * fails.
 *
 * **1. The runtime is not guaranteed to carry the data, and the failure is
 * silent in Arabic.** `Intl.DisplayNames` reads CLDR out of whatever ICU the
 * runtime was built with. Node's own builds ship full ICU and this machine's
 * does — `process.versions.icu` is `78.3` on `v24.19.0`, measured — but a
 * small-icu or system-icu build resolves only the locales it has, and the
 * documented behaviour is to **fall back to the default locale** rather than to
 * throw. An Arabic panel on such a runtime would draw 249 English country names
 * under a correct Arabic label, which is precisely the failure the house rule
 * about French and Arabic being in exact sync exists to catch, and it would ship
 * looking fine on every machine that had the data.
 *
 * **2. Two ICUs render one page.** These controls are client components and Next
 * still renders them on the server for the first paint, so the option labels are
 * produced by **Node's** CLDR and then hydrated against **the browser's**. CLDR
 * revises country names — `SZ`, `MK` and `CZ` have all been renamed within the
 * lifetime of browsers still in use, and `TR` was renamed in one language and
 * not another. That last one is measured in this runtime rather than recalled:
 * `Intl.DisplayNames` here answers `Türkiye` for `en` and `Turquie` for `fr`,
 * from one ICU, for one code. A browser a release or two behind the server
 * disagrees about a row and React reports a hydration mismatch for it — over a
 * list whose whole job is to be boring. A static table is the same bytes on both
 * sides by construction.
 *
 * **3. Sort order, which is the part that is easy to miss.** The names have to
 * be collated in the reader's language or the list is unusable, and Arabic is
 * where that bites: `Intl.Collator("ar")` orders by the Arabic alphabet, so the
 * list opens `آيسلندا · إثيوبيا · أذربيجان · أرمينيا · أروبا` — measured — and
 * the definite article is **not** stripped, so `الجزائر` sorts under `ا` with
 * every other `ال…` name rather than under `ج`. That is CLDR's decision and it
 * is the right one; the point is that it is a *decision*, made by data the
 * runtime may not have. Worse, a re-sort at render is not merely a different
 * order — the server and the client would emit the same 249 options in two
 * sequences, which is a hydration mismatch on every row after the first
 * disagreement rather than on one.
 *
 * ## So: a generated table, with its recipe, not a typed one
 *
 * The names below were produced by `Intl.DisplayNames` **once, here, at
 * authoring time**, on Node `v24.19.0` / ICU `78.3`, and committed. The runtime
 * dependency is spent at authoring time where its failure is visible in a diff,
 * instead of at render where it is visible to an operator. Regenerating is a
 * few lines and the exact recipe is:
 *
 *  1. every `AA`–`ZZ` pair that `Intl.DisplayNames(["fr"|"ar"], {type:"region",
 *     fallback:"none"})` resolves a name for in **both** languages — 280 codes;
 *  2. minus the 31 named in `NOT_A_COUNTRY` below, each with what it actually is;
 *  3. sorted per locale with `Intl.Collator("fr")` and `Intl.Collator("ar")`.
 *
 * **280 − 31 = 249 — that subtraction is measured, by the generator, and the
 * table below is 249 rows.** 249 is also the number of alpha-2 codes ISO 3166-1
 * officially assigns; that half is a published figure rather than something
 * measured here, and the two agreeing is the check that the exclusion list is
 * neither short nor greedy. It is why the exclusions are enumerated with reasons
 * rather than applied as a regex: a reader can audit thirty-one lines, and
 * `tests/countries.test.ts` re-checks the count, the shape and the sync of the
 * two orders on every run.
 *
 * ## What a code outside this table renders as
 *
 * Itself, always, and never nothing. `countryName` answers `null` rather than a
 * guess, and `AddressFields` turns that into an option carrying the raw code
 * with a second line saying the shop does not recognise it — which is the state
 * of any order already carrying `ZZ`, and of any order whose country was written
 * by wp-admin or by a client that is not this panel. A list that silently
 * dropped an unrecognised value would let a form save a country the operator
 * never saw, which is the one behaviour a picker must not add over a text box.
 *
 * ## Both languages ship in one module, deliberately
 *
 * ~20 KB of source, and a locale switch in this panel is a navigation rather
 * than a re-render, so the unused half could in principle be split away. It is
 * not, because the split would have to be a dynamic import inside a form control
 * — a suspending boundary in the middle of an address block, to save a few
 * kilobytes of highly compressible text on the two screens that draw one. The
 * cost is named here rather than left for somebody to discover in a bundle
 * report.
 */

/**
 * Which country each code is called, `[French, Arabic]`.
 *
 * Sorted by code, because a table sorted by either name would be sorted wrongly
 * for the other reader; the two reading orders are `COUNTRY_ORDER` below, and
 * they are the only place a name decides a position.
 */
const COUNTRY_NAMES: Readonly<Record<string, readonly [fr: string, ar: string]>> = {
  AD: ["Andorre", "أندورا"],
  AE: ["Émirats arabes unis", "الإمارات العربية المتحدة"],
  AF: ["Afghanistan", "أفغانستان"],
  AG: ["Antigua-et-Barbuda", "أنتيغوا وبربودا"],
  AI: ["Anguilla", "أنغويلا"],
  AL: ["Albanie", "ألبانيا"],
  AM: ["Arménie", "أرمينيا"],
  AO: ["Angola", "أنغولا"],
  AQ: ["Antarctique", "أنتاركتيكا"],
  AR: ["Argentine", "الأرجنتين"],
  AS: ["Samoa américaines", "ساموا الأمريكية"],
  AT: ["Autriche", "النمسا"],
  AU: ["Australie", "أستراليا"],
  AW: ["Aruba", "أروبا"],
  AX: ["Îles Åland", "جزر آلاند"],
  AZ: ["Azerbaïdjan", "أذربيجان"],
  BA: ["Bosnie-Herzégovine", "البوسنة والهرسك"],
  BB: ["Barbade", "بربادوس"],
  BD: ["Bangladesh", "بنغلاديش"],
  BE: ["Belgique", "بلجيكا"],
  BF: ["Burkina Faso", "بوركينا فاسو"],
  BG: ["Bulgarie", "بلغاريا"],
  BH: ["Bahreïn", "البحرين"],
  BI: ["Burundi", "بوروندي"],
  BJ: ["Bénin", "بنين"],
  BL: ["Saint-Barthélemy", "سان بارتليمي"],
  BM: ["Bermudes", "برمودا"],
  BN: ["Brunei", "بروناي"],
  BO: ["Bolivie", "بوليفيا"],
  BQ: ["Pays-Bas caribéens", "هولندا الكاريبية"],
  BR: ["Brésil", "البرازيل"],
  BS: ["Bahamas", "جزر البهاما"],
  BT: ["Bhoutan", "بوتان"],
  BV: ["Île Bouvet", "جزيرة بوفيه"],
  BW: ["Botswana", "بوتسوانا"],
  BY: ["Biélorussie", "بيلاروس"],
  BZ: ["Belize", "بليز"],
  CA: ["Canada", "كندا"],
  CC: ["Îles Cocos", "جزر كوكوس (كيلينغ)"],
  CD: ["Congo-Kinshasa", "الكونغو - كينشاسا"],
  CF: ["République centrafricaine", "جمهورية أفريقيا الوسطى"],
  CG: ["Congo-Brazzaville", "الكونغو - برازافيل"],
  CH: ["Suisse", "سويسرا"],
  CI: ["Côte d’Ivoire", "ساحل العاج"],
  CK: ["Îles Cook", "جزر كوك"],
  CL: ["Chili", "تشيلي"],
  CM: ["Cameroun", "الكاميرون"],
  CN: ["Chine", "الصين"],
  CO: ["Colombie", "كولومبيا"],
  CR: ["Costa Rica", "كوستاريكا"],
  CU: ["Cuba", "كوبا"],
  CV: ["Cap-Vert", "الرأس الأخضر"],
  CW: ["Curaçao", "كوراساو"],
  CX: ["Île Christmas", "جزيرة كريسماس"],
  CY: ["Chypre", "قبرص"],
  CZ: ["Tchéquie", "التشيك"],
  DE: ["Allemagne", "ألمانيا"],
  DJ: ["Djibouti", "جيبوتي"],
  DK: ["Danemark", "الدانمرك"],
  DM: ["Dominique", "دومينيكا"],
  DO: ["République dominicaine", "جمهورية الدومينيكان"],
  DZ: ["Algérie", "الجزائر"],
  EC: ["Équateur", "الإكوادور"],
  EE: ["Estonie", "إستونيا"],
  EG: ["Égypte", "مصر"],
  EH: ["Sahara occidental", "الصحراء الغربية"],
  ER: ["Érythrée", "إريتريا"],
  ES: ["Espagne", "إسبانيا"],
  ET: ["Éthiopie", "إثيوبيا"],
  FI: ["Finlande", "فنلندا"],
  FJ: ["Fidji", "فيجي"],
  FK: ["Îles Malouines", "جزر فوكلاند"],
  FM: ["Micronésie", "ميكرونيزيا"],
  FO: ["Îles Féroé", "جزر فارو"],
  FR: ["France", "فرنسا"],
  GA: ["Gabon", "الغابون"],
  GB: ["Royaume-Uni", "المملكة المتحدة"],
  GD: ["Grenade", "غرينادا"],
  GE: ["Géorgie", "جورجيا"],
  GF: ["Guyane française", "غويانا الفرنسية"],
  GG: ["Guernesey", "غيرنزي"],
  GH: ["Ghana", "غانا"],
  GI: ["Gibraltar", "جبل طارق"],
  GL: ["Groenland", "غرينلاند"],
  GM: ["Gambie", "غامبيا"],
  GN: ["Guinée", "غينيا"],
  GP: ["Guadeloupe", "غوادلوب"],
  GQ: ["Guinée équatoriale", "غينيا الاستوائية"],
  GR: ["Grèce", "اليونان"],
  GS: ["Géorgie du Sud-et-les Îles Sandwich du Sud", "جورجيا الجنوبية وجزر ساندويتش الجنوبية"],
  GT: ["Guatemala", "غواتيمالا"],
  GU: ["Guam", "غوام"],
  GW: ["Guinée-Bissau", "غينيا بيساو"],
  GY: ["Guyana", "غيانا"],
  HK: ["R.A.S. chinoise de Hong Kong", "هونغ كونغ الصينية (منطقة إدارية خاصة)"],
  HM: ["Îles Heard-et-MacDonald", "جزيرة هيرد وجزر ماكدونالد"],
  HN: ["Honduras", "هندوراس"],
  HR: ["Croatie", "كرواتيا"],
  HT: ["Haïti", "هايتي"],
  HU: ["Hongrie", "هنغاريا"],
  ID: ["Indonésie", "إندونيسيا"],
  IE: ["Irlande", "أيرلندا"],
  IL: ["Israël", "إسرائيل"],
  IM: ["Île de Man", "جزيرة مان"],
  IN: ["Inde", "الهند"],
  IO: ["Territoire britannique de l’océan Indien", "الإقليم البريطاني في المحيط الهندي"],
  IQ: ["Irak", "العراق"],
  IR: ["Iran", "إيران"],
  IS: ["Islande", "آيسلندا"],
  IT: ["Italie", "إيطاليا"],
  JE: ["Jersey", "جيرسي"],
  JM: ["Jamaïque", "جامايكا"],
  JO: ["Jordanie", "الأردن"],
  JP: ["Japon", "اليابان"],
  KE: ["Kenya", "كينيا"],
  KG: ["Kirghizstan", "قيرغيزستان"],
  KH: ["Cambodge", "كمبوديا"],
  KI: ["Kiribati", "كيريباتي"],
  KM: ["Comores", "جزر القمر"],
  KN: ["Saint-Christophe-et-Niévès", "سانت كيتس ونيفيس"],
  KP: ["Corée du Nord", "كوريا الشمالية"],
  KR: ["Corée du Sud", "كوريا الجنوبية"],
  KW: ["Koweït", "الكويت"],
  KY: ["Îles Caïmans", "جزر كايمان"],
  KZ: ["Kazakhstan", "كازاخستان"],
  LA: ["Laos", "لاوس"],
  LB: ["Liban", "لبنان"],
  LC: ["Sainte-Lucie", "سانت لوسيا"],
  LI: ["Liechtenstein", "ليختنشتاين"],
  LK: ["Sri Lanka", "سريلانكا"],
  LR: ["Liberia", "ليبيريا"],
  LS: ["Lesotho", "ليسوتو"],
  LT: ["Lituanie", "ليتوانيا"],
  LU: ["Luxembourg", "لوكسمبورغ"],
  LV: ["Lettonie", "لاتفيا"],
  LY: ["Libye", "ليبيا"],
  MA: ["Maroc", "المغرب"],
  MC: ["Monaco", "موناكو"],
  MD: ["Moldavie", "مولدوفا"],
  ME: ["Monténégro", "الجبل الأسود"],
  MF: ["Saint-Martin", "سان مارتن"],
  MG: ["Madagascar", "مدغشقر"],
  MH: ["Îles Marshall", "جزر مارشال"],
  MK: ["Macédoine du Nord", "مقدونيا الشمالية"],
  ML: ["Mali", "مالي"],
  MM: ["Myanmar (Birmanie)", "ميانمار (بورما)"],
  MN: ["Mongolie", "منغوليا"],
  MO: ["R.A.S. chinoise de Macao", "منطقة ماكاو الإدارية الخاصة"],
  MP: ["Îles Mariannes du Nord", "جزر ماريانا الشمالية"],
  MQ: ["Martinique", "جزر المارتينيك"],
  MR: ["Mauritanie", "موريتانيا"],
  MS: ["Montserrat", "مونتسرات"],
  MT: ["Malte", "مالطا"],
  MU: ["Maurice", "موريشيوس"],
  MV: ["Maldives", "جزر المالديف"],
  MW: ["Malawi", "ملاوي"],
  MX: ["Mexique", "المكسيك"],
  MY: ["Malaisie", "ماليزيا"],
  MZ: ["Mozambique", "موزمبيق"],
  NA: ["Namibie", "ناميبيا"],
  NC: ["Nouvelle-Calédonie", "كاليدونيا الجديدة"],
  NE: ["Niger", "النيجر"],
  NF: ["Île Norfolk", "جزيرة نورفولك"],
  NG: ["Nigeria", "نيجيريا"],
  NI: ["Nicaragua", "نيكاراغوا"],
  NL: ["Pays-Bas", "هولندا"],
  NO: ["Norvège", "النرويج"],
  NP: ["Népal", "نيبال"],
  NR: ["Nauru", "ناورو"],
  NU: ["Niue", "نيوي"],
  NZ: ["Nouvelle-Zélande", "نيوزيلندا"],
  OM: ["Oman", "عُمان"],
  PA: ["Panama", "بنما"],
  PE: ["Pérou", "بيرو"],
  PF: ["Polynésie française", "بولينيزيا الفرنسية"],
  PG: ["Papouasie-Nouvelle-Guinée", "بابوا غينيا الجديدة"],
  PH: ["Philippines", "الفلبين"],
  PK: ["Pakistan", "باكستان"],
  PL: ["Pologne", "بولندا"],
  PM: ["Saint-Pierre-et-Miquelon", "سان بيير ومكويلون"],
  PN: ["Îles Pitcairn", "جزر بيتكيرن"],
  PR: ["Porto Rico", "بورتوريكو"],
  PS: ["Territoires palestiniens", "الأراضي الفلسطينية"],
  PT: ["Portugal", "البرتغال"],
  PW: ["Palaos", "بالاو"],
  PY: ["Paraguay", "باراغواي"],
  QA: ["Qatar", "قطر"],
  RE: ["La Réunion", "روينيون"],
  RO: ["Roumanie", "رومانيا"],
  RS: ["Serbie", "صربيا"],
  RU: ["Russie", "روسيا"],
  RW: ["Rwanda", "رواندا"],
  SA: ["Arabie saoudite", "المملكة العربية السعودية"],
  SB: ["Îles Salomon", "جزر سليمان"],
  SC: ["Seychelles", "سيشل"],
  SD: ["Soudan", "السودان"],
  SE: ["Suède", "السويد"],
  SG: ["Singapour", "سنغافورة"],
  SH: ["Sainte-Hélène", "سانت هيلينا"],
  SI: ["Slovénie", "سلوفينيا"],
  SJ: ["Svalbard et Jan Mayen", "سفالبارد وجان ماين"],
  SK: ["Slovaquie", "سلوفاكيا"],
  SL: ["Sierra Leone", "سيراليون"],
  SM: ["Saint-Marin", "سان مارينو"],
  SN: ["Sénégal", "السنغال"],
  SO: ["Somalie", "الصومال"],
  SR: ["Suriname", "سورينام"],
  SS: ["Soudan du Sud", "جنوب السودان"],
  ST: ["Sao Tomé-et-Principe", "ساو تومي وبرينسيبي"],
  SV: ["Salvador", "السلفادور"],
  SX: ["Saint-Martin (partie néerlandaise)", "سانت مارتن"],
  SY: ["Syrie", "سوريا"],
  SZ: ["Eswatini", "إسواتيني"],
  TC: ["Îles Turques-et-Caïques", "جزر توركس وكايكوس"],
  TD: ["Tchad", "تشاد"],
  TF: ["Terres australes françaises", "الأقاليم الجنوبية الفرنسية"],
  TG: ["Togo", "توغو"],
  TH: ["Thaïlande", "تايلاند"],
  TJ: ["Tadjikistan", "طاجيكستان"],
  TK: ["Tokelau", "توكيلاو"],
  TL: ["Timor oriental", "تيمور - ليشتي"],
  TM: ["Turkménistan", "تركمانستان"],
  TN: ["Tunisie", "تونس"],
  TO: ["Tonga", "تونغا"],
  TR: ["Turquie", "تركيا"],
  TT: ["Trinité-et-Tobago", "ترينيداد وتوباغو"],
  TV: ["Tuvalu", "توفالو"],
  TW: ["Taïwan", "تايوان"],
  TZ: ["Tanzanie", "تنزانيا"],
  UA: ["Ukraine", "أوكرانيا"],
  UG: ["Ouganda", "أوغندا"],
  UM: ["Îles mineures éloignées des États-Unis", "جزر الولايات المتحدة النائية"],
  US: ["États-Unis", "الولايات المتحدة"],
  UY: ["Uruguay", "أورغواي"],
  UZ: ["Ouzbékistan", "أوزبكستان"],
  VA: ["État de la Cité du Vatican", "الفاتيكان"],
  VC: ["Saint-Vincent-et-les Grenadines", "سانت فنسنت وجزر غرينادين"],
  VE: ["Venezuela", "فنزويلا"],
  VG: ["Îles Vierges britanniques", "جزر فيرجن البريطانية"],
  VI: ["Îles Vierges des États-Unis", "جزر فيرجن الأمريكية"],
  VN: ["Viêt Nam", "فيتنام"],
  VU: ["Vanuatu", "فانواتو"],
  WF: ["Wallis-et-Futuna", "جزر والس وفوتونا"],
  WS: ["Samoa", "ساموا"],
  YE: ["Yémen", "اليمن"],
  YT: ["Mayotte", "مايوت"],
  ZA: ["Afrique du Sud", "جنوب أفريقيا"],
  ZM: ["Zambie", "زامبيا"],
  ZW: ["Zimbabwe", "زيمبابوي"],
};

/**
 * The thirty-one codes ICU resolves a name for that ISO 3166-1 does not
 * currently assign to a country — kept here rather than deleted, because
 * *"thirty-one codes were dropped"* is not a claim a reader can check and this
 * is.
 *
 * Nothing reads this at runtime. It is the generator's input and the audit
 * trail for the subtraction, and `tests/countries.test.ts` asserts that none of
 * them is in the table.
 *
 * Grouped by why they are not countries, because the four groups fail
 * differently and a future reader deciding whether to re-admit one needs to know
 * which kind they are looking at.
 */
const NOT_A_COUNTRY: Readonly<Record<string, string>> = {
  /* Withdrawn from ISO 3166-1. ICU keeps them so historical data still renders,
     which is exactly why they must not be *offered*: a shop cannot ship to the
     USSR, and an operator who picks one has stored a code no courier maps. */
  AN: "Netherlands Antilles, dissolved 2010",
  BU: "Burma, now MM",
  CS: "Serbia and Montenegro, dissolved 2006",
  DD: "East Germany, dissolved 1990",
  DY: "Dahomey, now BJ",
  FX: "Metropolitan France, withdrawn 1997",
  HV: "Upper Volta, now BF",
  NH: "New Hebrides, now VU",
  RH: "Southern Rhodesia, now ZW",
  SU: "USSR, dissolved 1991",
  TP: "East Timor, now TL",
  VD: "North Vietnam, now VN",
  YD: "South Yemen, now YE",
  YU: "Yugoslavia, dissolved 2003",
  ZR: "Zaire, now CD",

  /* Exceptionally reserved, or CLDR subdivisions of a country the list already
     carries. Offering both `IC` and `ES` would let two operators store two
     different countries for one address in Tenerife. */
  AC: "Ascension Island, part of SH",
  CP: "Clipperton Island, part of FR",
  CQ: "Sark, part of GG",
  DG: "Diego Garcia, part of IO",
  EA: "Ceuta and Melilla, part of ES",
  IC: "Canary Islands, part of ES",
  TA: "Tristan da Cunha, part of SH",
  UK: "reserved alias of GB",

  /* Regions and organisations. A parcel is not addressed to the Eurozone. */
  EU: "European Union",
  EZ: "Eurozone",
  QO: "Outlying Oceania",
  UN: "United Nations",

  /* User-assigned and private use. `ZZ` is the one this whole control has to
     survive: it is CLDR's *unknown region*, it passes the API's `^[A-Z]{2}$`
     with a 200, and an order in this shop may already be carrying it. It is not
     an option — it is the case `countryName` answers `null` for. */
  XA: "pseudo-locale, accented English",
  XB: "pseudo-locale, bidirectional English",
  XK: "Kosovo, user-assigned, no ISO 3166-1 code",
  ZZ: "unknown or invalid region",
};

/**
 * The reading order, per language, decided once by `Intl.Collator` at authoring
 * time rather than at render — see the file docblock's third count against
 * runtime `Intl`.
 *
 * The two arrays hold the **same 249 codes** and differ only in sequence; that
 * is what *"French and Arabic in exact sync"* means for a list rather than for a
 * sentence, and it is asserted rather than asserted-in-prose:
 * `tests/countries.test.ts` checks each is a permutation of the other and of
 * `COUNTRY_NAMES`' keys.
 *
 * The Arabic order is the one worth looking at before changing anything. It
 * opens `آيسلندا · إثيوبيا · أذربيجان · أرمينيا · أروبا`, and `الجزائر` sits
 * under `ا` beside every other `ال…` name rather than under `ج` — CLDR does not
 * strip the definite article, and neither does this. Re-sorting it "properly" by
 * hand is how a list stops matching what an Arabic reader's other software does.
 */
const COUNTRY_ORDER: Readonly<Record<"fr" | "ar", readonly string[]>> = {
  fr: [
    "AF", "ZA", "AL", "DZ", "DE", "AD", "AO", "AI", "AQ", "AG", "SA", "AR",
    "AM", "AW", "AU", "AT", "AZ", "BS", "BH", "BD", "BB", "BE", "BZ", "BJ",
    "BM", "BT", "BY", "BO", "BA", "BW", "BR", "BN", "BG", "BF", "BI", "KH",
    "CM", "CA", "CV", "CL", "CN", "CY", "CO", "KM", "CG", "CD", "KP", "KR",
    "CR", "CI", "HR", "CU", "CW", "DK", "DJ", "DM", "EG", "AE", "EC", "ER",
    "ES", "EE", "SZ", "VA", "US", "ET", "FJ", "FI", "FR", "GA", "GM", "GE",
    "GS", "GH", "GI", "GR", "GD", "GL", "GP", "GU", "GT", "GG", "GN", "GQ",
    "GW", "GY", "GF", "HT", "HN", "HU", "BV", "CX", "IM", "NF", "AX", "KY",
    "CC", "CK", "FO", "HM", "FK", "MP", "MH", "UM", "PN", "SB", "TC", "VG",
    "VI", "IN", "ID", "IQ", "IR", "IE", "IS", "IL", "IT", "JM", "JP", "JE",
    "JO", "KZ", "KE", "KG", "KI", "KW", "RE", "LA", "LS", "LV", "LB", "LR",
    "LY", "LI", "LT", "LU", "MK", "MG", "MY", "MW", "MV", "ML", "MT", "MA",
    "MQ", "MU", "MR", "YT", "MX", "FM", "MD", "MC", "MN", "ME", "MS", "MZ",
    "MM", "NA", "NR", "NP", "NI", "NE", "NG", "NU", "NO", "NC", "NZ", "OM",
    "UG", "UZ", "PK", "PW", "PA", "PG", "PY", "NL", "BQ", "PE", "PH", "PL",
    "PF", "PR", "PT", "QA", "HK", "MO", "CF", "DO", "RO", "GB", "RU", "RW",
    "EH", "BL", "KN", "SM", "MF", "SX", "PM", "VC", "SH", "LC", "SV", "WS",
    "AS", "ST", "SN", "RS", "SC", "SL", "SG", "SK", "SI", "SO", "SD", "SS",
    "LK", "SE", "CH", "SR", "SJ", "SY", "TJ", "TW", "TZ", "TD", "CZ", "TF",
    "IO", "PS", "TH", "TL", "TG", "TK", "TO", "TT", "TN", "TM", "TR", "TV",
    "UA", "UY", "VU", "VE", "VN", "WF", "YE", "ZM", "ZW",
  ],
  ar: [
    "IS", "ET", "AZ", "AM", "AW", "ER", "ES", "AU", "EE", "IL", "SZ", "AF",
    "PS", "AR", "JO", "TF", "IO", "EC", "AE", "AL", "BH", "BR", "PT", "BA",
    "CZ", "ME", "DZ", "DK", "CV", "SV", "SN", "SD", "SE", "EH", "SO", "CN",
    "IQ", "GA", "VA", "PH", "CM", "CG", "CD", "KW", "DE", "MA", "MX", "SA",
    "GB", "NO", "AT", "NE", "IN", "US", "JP", "YE", "GR", "AQ", "AG", "AD",
    "ID", "AO", "AI", "UY", "UZ", "UG", "UA", "IR", "IE", "IT", "PG", "PY",
    "PK", "PW", "BB", "BM", "BN", "BE", "BG", "BZ", "BD", "PA", "BJ", "BT",
    "BW", "PR", "BF", "BI", "PL", "BO", "PF", "PE", "BY", "TH", "TW", "TM",
    "TR", "TT", "TD", "CL", "TZ", "TG", "TV", "TK", "TN", "TO", "TL", "JM",
    "GI", "AX", "BS", "KM", "MQ", "MV", "UM", "PN", "TC", "SB", "FO", "FK",
    "VI", "VG", "KY", "CK", "CC", "MH", "MP", "WF", "BV", "CX", "IM", "NF",
    "HM", "CF", "DO", "ZA", "SS", "GE", "GS", "DJ", "JE", "DM", "RW", "RU",
    "RO", "RE", "ZM", "ZW", "CI", "WS", "AS", "BL", "PM", "MF", "SM", "VC",
    "KN", "LC", "SX", "SH", "ST", "LK", "SJ", "SK", "SI", "SG", "SY", "SR",
    "CH", "SL", "SC", "RS", "TJ", "OM", "GM", "GH", "GD", "GL", "GT", "GP",
    "GU", "GF", "GY", "GG", "GN", "GQ", "GW", "VU", "FR", "VE", "FI", "VN",
    "FJ", "CY", "QA", "KG", "KZ", "NC", "HR", "KH", "CA", "CU", "CW", "KR",
    "KP", "CR", "CO", "KI", "KE", "LV", "LA", "LB", "LU", "LY", "LR", "LT",
    "LI", "LS", "MT", "ML", "MY", "YT", "MG", "EG", "MK", "MW", "MO", "MN",
    "MR", "MU", "MZ", "MD", "MC", "MS", "MM", "FM", "NA", "NR", "NP", "NG",
    "NI", "NZ", "NU", "HT", "HN", "HU", "NL", "BQ", "HK",
  ],
};

/**
 * Algeria, and the one place the panel writes that down.
 *
 * Every order this shop takes by phone is an Algerian order until somebody says
 * otherwise, which is the same argument `new-order.ts` makes for opening the
 * delivery type on `home`: a form has to draw something, and the honest default
 * is the one that is right almost always and visible when it is not.
 *
 * **A default the create form states, never one the edit form invents.**
 * `emptyDraft()` seeds it; `addressDraftOf()` does not, because that draft is
 * *reporting* a stored address rather than stating a new one, and an order whose
 * country was never filled in must keep saying so. `order-edit.ts` draws the
 * same line for `deliveryType` and gives the reason in those words.
 */
export const DEFAULT_COUNTRY = "DZ";

/**
 * What this code is called in this language — or `null` for *the shop does not
 * recognise it*.
 *
 * `null` rather than the code itself, so the caller has to decide what an
 * unrecognised country looks like instead of receiving something that renders
 * like a name and is not one. `AddressFields` decides: the raw code, with a
 * second line saying it is off the list.
 *
 * Case-folded on the way in, because `AddressInput::validateCountry()` accepts
 * a lowercase code and upper-cases it — read from source — so an order stored by
 * some other client may hold `dz`, and a picker that failed to match it would
 * report the shop's own country as unrecognised.
 *
 * Arabic for `ar`, French for everything else. The panel has two locales and the
 * fallback is French rather than a third behaviour, which is the rule
 * `lib/geography.ts`'s `placeName` already follows.
 */
export function countryName(code: string, locale: string): string | null {
  const names = COUNTRY_NAMES[code.trim().toUpperCase()];
  if (names === undefined) return null;
  return locale === "ar" ? names[1] : names[0];
}

/** Is this a code at all, whatever it names? See `COUNTRY_SHAPE`. */
export function isCountryShape(code: string): boolean {
  return COUNTRY_SHAPE.test(code.trim());
}

/**
 * `Commerce\AddressInput::validateCountry()`'s rule, run locally.
 *
 * **Kept, and it now does a different job than it did as a text field's
 * `validate`.** Nobody can type a country any more, so this can no longer catch
 * an operator writing `Algeria` — the picker makes that unreachable. What it
 * still catches is a value that arrived from somewhere else: an order written by
 * wp-admin, by the storefront, or by a client that is not this panel, whose
 * `country` is neither in the table nor even a code. The control splits its
 * off-list case on this, so `ZZ` and `Algeria` get different sentences instead
 * of one shrug.
 *
 * `[A-Za-z]` and not `[A-Z]`: the API upper-cases before it tests, so a
 * lowercase code is well-shaped as far as the wire is concerned.
 */
const COUNTRY_SHAPE = /^[A-Za-z]{2}$/;

/**
 * The 249 countries as a picker's options, in this language's own order.
 *
 * Built once per locale and cached, because the arrays are immutable and a
 * `.map()` over 249 rows inside a re-rendering form control is 249 objects per
 * keystroke in the field beside it. The cache is a module-level `Map` with two
 * possible keys and no invalidation, which is the correct amount of machinery
 * for data that is frozen at build time.
 *
 * Plain `{value, label}` rather than `ListboxOption`, so this module keeps its
 * "no dependencies" property — the shape is structurally assignable and
 * `AddressFields` is where the two meet.
 */
const OPTION_CACHE = new Map<string, readonly { value: string; label: string }[]>();

export function countryOptions(locale: string): readonly { value: string; label: string }[] {
  const key = locale === "ar" ? "ar" : "fr";
  const cached = OPTION_CACHE.get(key);
  if (cached !== undefined) return cached;

  const options = COUNTRY_ORDER[key].map((code) => ({
    value: code,
    /* Never `null` here: the order arrays are permutations of the table's own
       keys, which `tests/countries.test.ts` asserts. The `?? code` is the floor
       under a hand-edit that broke that property, and it renders the code rather
       than the string "null". */
    label: countryName(code, key) ?? code,
  }));

  OPTION_CACHE.set(key, options);
  return options;
}

/** Every code in the table, for the test that keeps the two orders in sync. */
export const COUNTRY_CODES: readonly string[] = Object.keys(COUNTRY_NAMES);

/** The orders, exported for the same test and for nothing else. */
export const COUNTRY_READING_ORDER = COUNTRY_ORDER;

/** The excluded set, exported for the same test and for nothing else. */
export const EXCLUDED_CODES = NOT_A_COUNTRY;
