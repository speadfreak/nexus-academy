// LEARNYX MATRIC OS — Verified Starter Practice Bank (curated seed data).
//
// PURPOSE: guarantee the exam engine works on day one, even before real
// digitized papers are synced into the vault. Every question here is
// HUMAN-AUTHORED for Learnyx, tied to the Ethiopian secondary curriculum,
// with an answer deliberately verified while authoring this file (math
// answers are computed; factual items are settled, uncontested knowledge).
// They are NOT official ESSLCE items and are NEVER presented as such —
// the vault rows carry paperTitle "Learnyx Verified Starter Bank — ..."
// and NO examYear, so no surface can dress them up as a real sitting.
//
// IDEMPOTENCY: the importer (matricAdmin.adminSeedStarterBank) upserts
// rows by (contentId, questionNumber) with contentVersion comparison.
// Editing a question's text/key here bumps the content version on the next
// seed run, which updates the vault row in place.

// ── Subject resolution maps ──────────────────────────────────────────────
// Streams follow the ESSLCE split: common (everybody sits), natural science
// and social science streams. Used to lazily create a missing subject row.

export const SEED_SUBJECT_STREAMS: Record<SeedQuestion["subjectSlug"], "common" | "natural" | "social"> = {
  english: "common",
  mathematics: "common",
  "scholastic-aptitude-test": "common",
  physics: "natural",
  chemistry: "natural",
  biology: "natural",
  history: "social",
  geography: "social",
  economics: "social",
};

export const SEED_SUBJECT_NAMES: Partial<Record<SeedQuestion["subjectSlug"], string>> = {
  english: "English",
  mathematics: "Mathematics",
  "scholastic-aptitude-test": "Scholastic Aptitude Test",
  physics: "Physics",
  chemistry: "Chemistry",
  biology: "Biology",
  history: "History",
  geography: "Geography",
  economics: "Economics",
};

export interface SeedQuestion {
  id: string;
  subjectSlug:
    | "english"
    | "mathematics"
    | "physics"
    | "chemistry"
    | "biology"
    | "history"
    | "geography"
    | "economics"
    | "scholastic-aptitude-test";
  topic: string;
  stem: string;
  passage?: string;
  options: [string, string, string, string]; // texts for A–D
  answer: "A" | "B" | "C" | "D";
  explanation: string;
}

export const SEED_BANK: SeedQuestion[] = [
  // ── ENGLISH (10) ────────────────────────────────────────────────────
  {
    id: "eng-01",
    subjectSlug: "english",
    topic: "Subject–Verb Agreement",
    stem: "Choose the correct form to complete the sentence: “She ____ to school every morning.”",
    options: ["go", "goes", "going", "gone"],
    answer: "B",
    explanation:
      "With a third-person singular subject (she) in the simple present, the verb takes -s: “She goes to school every morning.”",
  },
  {
    id: "eng-02",
    subjectSlug: "english",
    topic: "Vocabulary",
    stem: "Choose the word that is closest in meaning to “diligent”.",
    options: ["lazy", "hardworking", "rude", "careless"],
    answer: "B",
    explanation:
      "“Diligent” describes someone who works carefully and with steady effort — i.e. hardworking.",
  },
  {
    id: "eng-03",
    subjectSlug: "english",
    topic: "Subject–Verb Agreement",
    stem: "Choose the correct form: “Neither of the boys ____ finished his homework.”",
    options: ["have", "has", "are", "were"],
    answer: "B",
    explanation:
      "“Neither” is singular, so it takes a singular verb: “Neither of the boys has finished his homework.”",
  },
  {
    id: "eng-04",
    subjectSlug: "english",
    topic: "Prepositions of Time",
    stem: "Choose the correct preposition: “She has been living in Addis Ababa ____ 2015.”",
    options: ["since", "for", "from", "at"],
    answer: "A",
    explanation:
      "“Since” is used with a point in time when the action started (2015); “for” is used with a duration (e.g. for nine years).",
  },
  {
    id: "eng-05",
    subjectSlug: "english",
    topic: "Active and Passive Voice",
    stem: "Change into the passive voice: “The teacher wrote the answer on the board.”",
    options: [
      "The answer on the board wrote the teacher.",
      "The answer was written on the board by the teacher.",
      "The answer is writing on the board by the teacher.",
      "The teacher was written the answer on the board.",
    ],
    answer: "B",
    explanation:
      "Past simple passive = was/were + past participle. The object (“the answer”) becomes the subject: “The answer was written on the board by the teacher.”",
  },
  {
    id: "eng-06",
    subjectSlug: "english",
    topic: "Reported Speech",
    stem: "Report the sentence: He said, “I am tired.”",
    options: [
      "He said that he is tired.",
      "He said that he was tired.",
      "He says that he was tired.",
      "He said that I am tired.",
    ],
    answer: "B",
    explanation:
      "In reported speech the present “am” shifts back to “was”, and the pronoun “I” becomes “he”: “He said that he was tired.”",
  },
  {
    id: "eng-07",
    subjectSlug: "english",
    topic: "Vocabulary — Antonyms",
    stem: "Choose the word that is opposite in meaning to “abundant”.",
    options: ["plentiful", "scarce", "rich", "large"],
    answer: "B",
    explanation: "“Abundant” means existing in large quantities; its opposite is “scarce” (in short supply).",
  },
  {
    id: "eng-08",
    subjectSlug: "english",
    topic: "Conditional Sentences",
    stem: "Choose the correct form: “If I ____ rich, I would build a school in my village.”",
    options: ["am", "was", "were", "will be"],
    answer: "C",
    explanation:
      "Second conditional (unreal present) uses “if + past subjunctive”: “If I were rich, I would build…”. “Were” is used for all persons.",
  },
  {
    id: "eng-09",
    subjectSlug: "english",
    topic: "Reading Comprehension — Inference",
    stem: "According to the passage, why do fewer visitors come during the dry season?",
    passage:
      "The Blue Nile Falls near Bahir Dar attracts thousands of visitors each year, though the volume of water dropping over the cliff falls sharply during the dry season, when much of the river's flow is diverted upstream for irrigation and power.",
    options: [
      "The road to the falls is closed in the dry season.",
      "The falls carry much less water then.",
      "Tickets cost more in the dry season.",
      "The falls freeze during the dry season.",
    ],
    answer: "B",
    explanation:
      "The passage states the water volume “falls sharply during the dry season”, so the falls are less impressive to visitors.",
  },
  {
    id: "eng-10",
    subjectSlug: "english",
    topic: "Word Formation",
    stem: "Use the correct form of the word in brackets: “Her ____ (discover) in the experiment surprised everyone.”",
    options: ["discover", "discovering", "discovery", "discovered"],
    answer: "C",
    explanation:
      "A possessive (her) must be followed by a noun; the noun form of “discover” is “discovery”.",
  },

  // ── MATHEMATICS (10) — answers computed, no ambiguity ───────────────
  {
    id: "math-01",
    subjectSlug: "mathematics",
    topic: "Linear Equations",
    stem: "Solve for x:  3x − 7 = 14.",
    options: ["x = 5", "x = 6", "x = 7", "x = 8"],
    answer: "C",
    explanation: "3x = 14 + 7 = 21, so x = 21 ÷ 3 = 7. Check: 3(7) − 7 = 14 ✓",
  },
  {
    id: "math-02",
    subjectSlug: "mathematics",
    topic: "Exponents and Powers",
    stem: "Simplify: (x²)³.",
    options: ["x⁵", "x⁶", "x⁸", "x⁹"],
    answer: "B",
    explanation: "A power raised to a power multiplies the exponents: (x²)³ = x^(2×3) = x⁶.",
  },
  {
    id: "math-03",
    subjectSlug: "mathematics",
    topic: "Trigonometry",
    stem: "What is the exact value of sin 30°?",
    options: ["1/2", "√2/2", "√3/2", "1"],
    answer: "A",
    explanation: "From the 30-60-90 reference triangle, sin 30° = opposite/hypotenuse = 1/2.",
  },
  {
    id: "math-04",
    subjectSlug: "mathematics",
    topic: "Coordinate Geometry",
    stem: "Find the slope of the line through the points (1, 2) and (3, 10).",
    options: ["2", "3", "4", "8"],
    answer: "C",
    explanation: "Slope = (10 − 2) / (3 − 1) = 8 / 2 = 4.",
  },
  {
    id: "math-05",
    subjectSlug: "mathematics",
    topic: "Mensuration",
    stem: "A circle has radius 7 cm. Taking π = 22/7, what is its area?",
    options: ["44 cm²", "154 cm²", "49 cm²", "22 cm²"],
    answer: "B",
    explanation: "Area = πr² = (22/7) × 7² = (22/7) × 49 = 22 × 7 = 154 cm².",
  },
  {
    id: "math-06",
    subjectSlug: "mathematics",
    topic: "Sequences and Series",
    stem: "What is the sum of the first 20 positive integers?",
    options: ["190", "200", "210", "220"],
    answer: "C",
    explanation: "Sum = n(n + 1)/2 = 20 × 21 / 2 = 210.",
  },
  {
    id: "math-07",
    subjectSlug: "mathematics",
    topic: "Functions",
    stem: "If f(x) = 2x + 3, what is f(5)?",
    options: ["10", "11", "13", "25"],
    answer: "C",
    explanation: "Substitute x = 5: f(5) = 2(5) + 3 = 13.",
  },
  {
    id: "math-08",
    subjectSlug: "mathematics",
    topic: "Quadratic Equations",
    stem: "Solve: x² − 5x + 6 = 0.",
    options: ["x = 1 or x = 6", "x = 2 or x = 3", "x = −2 or x = −3", "x = 3 or x = 4"],
    answer: "B",
    explanation: "Factor: (x − 2)(x − 3) = 0, so x = 2 or x = 3. (Check: 2 + 3 = 5, 2 × 3 = 6 ✓)",
  },
  {
    id: "math-09",
    subjectSlug: "mathematics",
    topic: "Statistics — Central Tendency",
    stem: "Find the mean of the data set: 4, 8, 6, 10, 12.",
    options: ["7", "8", "9", "10"],
    answer: "B",
    explanation: "Mean = (4 + 8 + 6 + 10 + 12) / 5 = 40 / 5 = 8.",
  },
  {
    id: "math-10",
    subjectSlug: "mathematics",
    topic: "Logarithms",
    stem: "Evaluate: log₂ 32.",
    options: ["4", "5", "6", "16"],
    answer: "B",
    explanation: "log₂ 32 asks “2 to what power gives 32?” Since 2⁵ = 32, the answer is 5.",
  },

  // ── PHYSICS (6) ─────────────────────────────────────────────────────
  {
    id: "phy-01",
    subjectSlug: "physics",
    topic: "Units and Measurement",
    stem: "What is the SI unit of force?",
    options: ["joule", "newton", "watt", "pascal"],
    answer: "B",
    explanation:
      "Force is measured in newtons (N); 1 N = 1 kg·m/s². Joule measures energy, watt power, pascal pressure.",
  },
  {
    id: "phy-02",
    subjectSlug: "physics",
    topic: "Newton's Laws",
    stem: "A 10 kg object on a frictionless surface is pushed with a net force of 50 N. What is its acceleration?",
    options: ["0.2 m/s²", "5 m/s²", "50 m/s²", "500 m/s²"],
    answer: "B",
    explanation: "Newton's second law: a = F/m = 50 N ÷ 10 kg = 5 m/s².",
  },
  {
    id: "phy-03",
    subjectSlug: "physics",
    topic: "Waves and Light",
    stem: "The speed of light in vacuum is approximately:",
    options: ["3 × 10⁵ m/s", "3 × 10⁶ m/s", "3 × 10⁸ m/s", "3 × 10¹⁰ m/s"],
    answer: "C",
    explanation: "The speed of light in vacuum is c ≈ 3 × 10⁸ m/s (299,792,458 m/s exactly by definition of the metre).",
  },
  {
    id: "phy-04",
    subjectSlug: "physics",
    topic: "Work and Energy",
    stem: "A force of 20 N moves a box 3 m in the direction of the force. How much work is done?",
    options: ["6.7 J", "23 J", "60 J", "600 J"],
    answer: "C",
    explanation: "Work = force × distance in the direction of the force = 20 N × 3 m = 60 J.",
  },
  {
    id: "phy-05",
    subjectSlug: "physics",
    topic: "Current Electricity",
    stem: "A 12 V battery is connected across a 4 Ω resistor. What current flows?",
    options: ["0.33 A", "3 A", "8 A", "48 A"],
    answer: "B",
    explanation: "Ohm's law: I = V/R = 12 V ÷ 4 Ω = 3 A.",
  },
  {
    id: "phy-06",
    subjectSlug: "physics",
    topic: "Gravitation and Weight",
    stem: "What is the weight of a 5 kg mass where g ≈ 10 m/s²?",
    options: ["5 N", "10 N", "50 N", "500 N"],
    answer: "C",
    explanation: "Weight = mg = 5 kg × 10 m/s² = 50 N. (Mass stays 5 kg — weight is the force.)",
  },

  // ── CHEMISTRY (6) ───────────────────────────────────────────────────
  {
    id: "chem-01",
    subjectSlug: "chemistry",
    topic: "Periodic Table",
    stem: "What is the chemical symbol for sodium?",
    options: ["So", "S", "Na", "N"],
    answer: "C",
    explanation: "Sodium's symbol Na comes from its Latin name “natrium”. S is sulfur, N is nitrogen.",
  },
  {
    id: "chem-02",
    subjectSlug: "chemistry",
    topic: "Atomic Structure",
    stem: "How many protons does a neutral carbon-12 atom contain?",
    options: ["4", "6", "12", "8"],
    answer: "B",
    explanation:
      "Carbon's atomic number is 6, so every carbon atom has 6 protons. The “12” in carbon-12 is the mass number (6 protons + 6 neutrons).",
  },
  {
    id: "chem-03",
    subjectSlug: "chemistry",
    topic: "Stoichiometry",
    stem: "What is the approximate molar mass of water, H₂O? (H = 1, O = 16)",
    options: ["10 g/mol", "16 g/mol", "18 g/mol", "20 g/mol"],
    answer: "C",
    explanation: "M(H₂O) = 2(1) + 16 = 18 g/mol.",
  },
  {
    id: "chem-04",
    subjectSlug: "chemistry",
    topic: "Acids and Bases",
    stem: "A solution with pH 5 is:",
    options: ["strongly basic", "weakly basic", "neutral", "acidic"],
    answer: "D",
    explanation: "On the pH scale, values below 7 are acidic (7 is neutral, above 7 basic). pH 5 is mildly acidic.",
  },
  {
    id: "chem-05",
    subjectSlug: "chemistry",
    topic: "Chemical Bonding",
    stem: "What type of bond forms in sodium chloride (NaCl)?",
    options: ["ionic bond", "covalent bond", "metallic bond", "hydrogen bond"],
    answer: "A",
    explanation:
      "Sodium transfers its valence electron to chlorine; the resulting Na⁺ and Cl⁻ ions attract electrostatically — an ionic bond.",
  },
  {
    id: "chem-06",
    subjectSlug: "chemistry",
    topic: "Chemical Reactions",
    stem: "Which gas is produced when dilute hydrochloric acid reacts with calcium carbonate?",
    options: ["oxygen", "hydrogen", "carbon dioxide", "nitrogen"],
    answer: "C",
    explanation:
      "Acid + carbonate → salt + water + carbon dioxide. CaCO₃ + 2HCl → CaCl₂ + H₂O + CO₂↑.",
  },

  // ── BIOLOGY (6) ─────────────────────────────────────────────────────
  {
    id: "bio-01",
    subjectSlug: "biology",
    topic: "Cell Biology — Organelles",
    stem: "Which organelle is known as the “powerhouse of the cell” because it releases energy from glucose?",
    options: ["nucleus", "ribosome", "mitochondrion", "chloroplast"],
    answer: "C",
    explanation: "Mitochondria carry out aerobic respiration, producing ATP — the cell's usable energy currency.",
  },
  {
    id: "bio-02",
    subjectSlug: "biology",
    topic: "Photosynthesis",
    stem: "Which gas do plants take in from the air for photosynthesis?",
    options: ["oxygen", "nitrogen", "carbon dioxide", "hydrogen"],
    answer: "C",
    explanation:
      "Photosynthesis uses light energy to convert carbon dioxide and water into glucose and oxygen: 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂.",
  },
  {
    id: "bio-03",
    subjectSlug: "biology",
    topic: "Blood and Immunity",
    stem: "Which blood cells defend the body against infection?",
    options: ["red blood cells", "white blood cells", "platelets", "plasma cells"],
    answer: "B",
    explanation:
      "White blood cells (leukocytes) recognize and destroy pathogens. Red cells carry oxygen; platelets clot blood.",
  },
  {
    id: "bio-04",
    subjectSlug: "biology",
    topic: "Genetics",
    stem: "Two heterozygous tall pea plants (Tt × Tt) are crossed. What phenotype ratio is expected in the offspring?",
    options: ["1 tall : 1 short", "3 tall : 1 short", "all tall", "all short"],
    answer: "B",
    explanation:
      "Tt × Tt gives TT, Tt, Tt, tt — three genotypes showing the dominant tall phenotype and one short (tt): 3 : 1.",
  },
  {
    id: "bio-05",
    subjectSlug: "biology",
    topic: "Cell Theory",
    stem: "What is the basic structural and functional unit of all living organisms?",
    options: ["tissue", "organ", "cell", "molecule"],
    answer: "C",
    explanation: "Cell theory states that all living things are made of cells, and the cell is the basic unit of life.",
  },
  {
    id: "bio-06",
    subjectSlug: "biology",
    topic: "Cell Biology — Protein Synthesis",
    stem: "Which organelle is the site of protein synthesis in the cell?",
    options: ["ribosome", "lysosome", "vacuole", "mitochondrion"],
    answer: "A",
    explanation: "Ribosomes translate mRNA into amino-acid chains — they build the cell's proteins.",
  },

  // ── HISTORY (45: 5 original + 40 verified expansion) ─────────────────
  {
    id: "his-01",
    subjectSlug: "history",
    topic: "Modern Ethiopian History",
    stem: "In which year did the Battle of Adwa take place?",
    options: ["1868", "1896", "1913", "1935"],
    answer: "B",
    explanation: "Ethiopian forces defeated the invading Italian army at Adwa on 1 March 1896.",
  },
  {
    id: "his-02",
    subjectSlug: "history",
    topic: "Ethiopian Medieval History",
    stem: "The famous rock-hewn churches of Lalibela were built during which dynasty?",
    options: ["Solomonic dynasty", "Zagwe dynasty", "Aksumite dynasty", "Shewa dynasty"],
    answer: "B",
    explanation:
      "The eleven monolithic churches at Lalibela were carved under the Zagwe dynasty (12th–13th centuries), most notably during King Lalibela's reign.",
  },
  {
    id: "his-03",
    subjectSlug: "history",
    topic: "Ethiopian Ancient History",
    stem: "The ancient Kingdom of Aksum is best known for:",
    options: [
      "its giant carved stone obelisks (stelae)",
      "the pintado cave paintings of Sof Omar",
      "building the Fasil Ghebbi castle complex",
      "introducing the steam engine to Africa",
    ],
    answer: "A",
    explanation:
      "Aksum (1st–8th centuries CE) erected huge carved granite stelae, conducted Red Sea trade, and minted its own coins.",
  },
  {
    id: "his-04",
    subjectSlug: "history",
    topic: "Ethiopian Modern History — 20th Century",
    stem: "Which committee seized power in Ethiopia in 1974 and deposed Emperor Haile Selassie?",
    options: ["the Arbegnoch", "the Derg", "the EPRDF", "the Shewan nobility"],
    answer: "B",
    explanation:
      "The Coordinating Committee of the Armed Forces — the Derg — under Mengistu Haile Mariam took power in 1974.",
  },
  {
    id: "his-05",
    subjectSlug: "history",
    topic: "World History",
    stem: "The League of Nations was founded in 1920 in the aftermath of which event?",
    options: ["World War I", "World War II", "the Industrial Revolution", "the Cold War"],
    answer: "A",
    explanation:
      "The League was created by the Treaty of Versailles (1919–1920) to prevent a repeat of the devastation of World War I.",
  },

  // ── HISTORY EXPANSION (his-06 … his-45) — Ancient to Modern Ethiopia and
  //    the World. Human-authored for Learnyx, curriculum-aligned, settled
  //    and uncontested facts only. Appended AFTER his-05 so the
  //    (contentId, questionNumber) upsert mapping stays stable.
  {
    id: "his-06",
    subjectSlug: "history",
    topic: "Ancient Ethiopia — Aksum",
    stem: "Which Aksumite king is credited with making Christianity the leading religion of the Aksumite kingdom in the 4th century AD?",
    options: ["King Ezana", "King Kaleb", "Yekuno Amlak", "King Lalibela"],
    answer: "A",
    explanation:
      "King Ezana embraced Christianity in the early 4th century AD, making Aksum one of the earliest states in the world to adopt the faith.",
  },
  {
    id: "his-07",
    subjectSlug: "history",
    topic: "Ancient Ethiopia — Aksum",
    stem: "The ancient port of Adulis, which linked the Aksumite kingdom to trade across the Red Sea and the Indian Ocean, lay on the shore of which sea?",
    options: ["the Mediterranean Sea", "the Red Sea", "the Persian Gulf", "the Caspian Sea"],
    answer: "B",
    explanation:
      "Adulis stood on the Red Sea coast and handled Aksum's export–import trade with Egypt, Arabia, India and the Roman world.",
  },
  {
    id: "his-08",
    subjectSlug: "history",
    topic: "Ancient Ethiopia — Aksum",
    stem: "The giant carved stelae (obelisks) of Aksum were erected mainly to serve as what?",
    options: [
      "grave markers for royalty and nobles",
      "sundials for farmers",
      "watchtowers against invasion",
      "road signs for trade caravans",
    ],
    answer: "A",
    explanation:
      "Aksum's towering stelae marked the tombs of the kingdom's elite and remain the most famous monuments of Aksumite civilization.",
  },
  {
    id: "his-09",
    subjectSlug: "history",
    topic: "Medieval Ethiopia — Zagwe",
    stem: "The rock-hewn churches of Lalibela were built during the rule of which dynasty?",
    options: ["the Solomonic dynasty", "the Zagwe dynasty", "the Gondarine dynasty", "the Shewan dynasty"],
    answer: "B",
    explanation:
      "The Zagwe dynasty (c. 1137–1270), whose best-known king was Gebre Mesqel Lalibela, carved the eleven famous monolithic churches at Roha, later named Lalibela.",
  },
  {
    id: "his-10",
    subjectSlug: "history",
    topic: "Medieval Ethiopia — Solomonic Restoration",
    stem: "Which event marks the 'Solomonic Restoration' of 1270?",
    options: [
      "Yekuno Amlak defeated the last Zagwe ruler and claimed descent from King Solomon",
      "King Ezana converted to Christianity",
      "Fasilides founded the city of Gondar",
      "Menelik II defeated the Italians at Adwa",
    ],
    answer: "A",
    explanation:
      "In 1270 Yekuno Amlak overthrew the Zagwe dynasty and traced his lineage to Solomon and the Queen of Sheba, restoring the 'Solomonic' line of kings.",
  },
  {
    id: "his-11",
    subjectSlug: "history",
    topic: "Medieval Ethiopia — Literature",
    stem: "The Kebra Nagast ('Glory of Kings'), the national chronicle that legitimized Solomonic rule, was written in which language?",
    options: ["Ge'ez", "Amharic", "Afaan Oromo", "Arabic"],
    answer: "A",
    explanation:
      "The Kebra Nagast was composed in Ge'ez, the classical literary language of the Ethiopian church and court.",
  },
  {
    id: "his-12",
    subjectSlug: "history",
    topic: "Medieval Ethiopia — Adal War",
    stem: "The sixteenth-century war led by Ahmad ibn Ibrahim al-Ghazi ('Ahmad Gragn') was fought between the Christian kingdom and which Muslim sultanate?",
    options: ["the Adal Sultanate", "the Funj Sultanate", "the Fatimid Caliphate", "the Sultanate of Oman"],
    answer: "A",
    explanation:
      "Ahmad Gragn, ruler of the Adal Sultanate based at Harar, invaded the Christian highland kingdom in 1529, beginning a devastating sixteen-year war.",
  },
  {
    id: "his-13",
    subjectSlug: "history",
    topic: "Medieval Ethiopia — Adal War",
    stem: "Which European power sent soldiers, led by Christovão da Gama, to help the Ethiopian kingdom against Ahmad Gragn?",
    options: ["Spain", "Portugal", "the Ottoman Empire", "the Netherlands"],
    answer: "B",
    explanation:
      "Portugal answered Empress Seble Wengel's appeal; a Portuguese force under Christovão da Gama arrived in 1541, and Ahmad Gragn was killed in battle in 1543.",
  },
  {
    id: "his-14",
    subjectSlug: "history",
    topic: "Oromo Institutions",
    stem: "The Gadaa system of the Oromo people is best described as a:",
    options: [
      "hereditary monarchy",
      "generational age-grade system of governance with elected leaders",
      "religious cult restricted to priests",
      "system of tribute collection for emperors",
    ],
    answer: "B",
    explanation:
      "Gadaa organizes society into generational classes through which leaders are elected for fixed terms — one of Africa's oldest democratic institutions.",
  },
  {
    id: "his-15",
    subjectSlug: "history",
    topic: "Gondarine Period",
    stem: "Which emperor founded the city of Gondar, the capital of the Ethiopian kingdom from 1636?",
    options: ["Fasilides", "Susenyos", "Iyasu I", "Dawit II"],
    answer: "A",
    explanation:
      "Emperor Fasilides established Gondar as the permanent capital in 1636; his stone castle (Fasil Ghebbi) began the Gondarine architectural tradition.",
  },
  {
    id: "his-16",
    subjectSlug: "history",
    topic: "Zemene Mesafint",
    stem: "The Zemene Mesafint ('Era of Princes'), a period when regional lords ruled while emperors were mere figureheads, began in 1769 when which powerful lord deposed Emperor Iyoas?",
    options: ["Ras Mikael Sehul", "Ras Gugsa", "Dejazmach Wube", "Ras Ali I"],
    answer: "A",
    explanation:
      "Ras Mikael Sehul's murder of Emperor Iyoas in 1769 opened the Zemene Mesafint, during which warlords such as the Yejju Oromo Gugsa family held real power.",
  },
  {
    id: "his-17",
    subjectSlug: "history",
    topic: "Modern Ethiopia — Tewodros II",
    stem: "Emperor Tewodros II, who began reuniting the Ethiopian kingdom in 1855, died in 1868 at:",
    options: [
      "the Battle of Adwa",
      "his fortress of Maqdala, by his own hand as British forces stormed it",
      "the Battle of Metemma against the Mahdists",
      "exile in Jerusalem",
    ],
    answer: "B",
    explanation:
      "After Britain's Napier expedition marched on Maqdala in 1868, Tewodros released the hostages but refused to surrender and took his own life.",
  },
  {
    id: "his-18",
    subjectSlug: "history",
    topic: "Modern Ethiopia — Yohannes IV",
    stem: "Emperor Yohannes IV's armies crushed Egyptian invasion forces at the battles of:",
    options: ["Gundet and Gura", "Adwa and Adua", "Embagirtu and Metemma", "Senafe and Asmara"],
    answer: "A",
    explanation:
      "Yohannes IV defeated Egyptian armies at Gundet (1875) and Gura (1876), protecting Ethiopian independence on the northern frontier.",
  },
  {
    id: "his-19",
    subjectSlug: "history",
    topic: "Modern Ethiopia — Yohannes IV",
    stem: "Emperor Yohannes IV died in 1889 fighting against which force at Metemma?",
    options: ["the Italians", "the Egyptians", "the Mahdists of Sudan", "the French"],
    answer: "C",
    explanation:
      "Yohannes IV was mortally wounded at the Battle of Metemma (1889) fighting the Mahdist state that had arisen in Sudan.",
  },
  {
    id: "his-20",
    subjectSlug: "history",
    topic: "Modern Ethiopia — Menelik II",
    stem: "The Treaty of Wuchale (1889) between Ethiopia and Italy became the direct cause of the Battle of Adwa because:",
    options: [
      "Italy banned trade with Ethiopia",
      "the two language versions of Article 17 disagreed on whether Ethiopia must conduct foreign affairs through Italy",
      "Italy refused to return the Obelisk of Aksum",
      "Ethiopia signed a rival treaty with France",
    ],
    answer: "B",
    explanation:
      "The Italian text made Ethiopia an Italian protectorate while the Amharic text only permitted it; when Menelik II rejected the claim, Italy moved to war and was defeated at Adwa.",
  },
  {
    id: "his-21",
    subjectSlug: "history",
    topic: "Modern Ethiopia — Adwa",
    stem: "The Battle of Adwa, where Ethiopian forces defeated an invading European colonial army, took place on:",
    options: ["1 March 1896", "3 October 1935", "25 May 1963", "28 May 1991"],
    answer: "A",
    explanation:
      "On 1 March 1896 Menelik II's united Ethiopian armies crushed the Italian force at Adwa, securing Ethiopia's independence and inspiring anti-colonial movements across Africa.",
  },
  {
    id: "his-22",
    subjectSlug: "history",
    topic: "Modern Ethiopia — Addis Ababa",
    stem: "Addis Ababa was founded in 1886 at the Filwoha hot springs by:",
    options: ["Emperor Menelik II and Empress Taytu Betul", "Emperor Haile Selassie I", "Emperor Tewodros II", "Ras Mekonnen"],
    answer: "A",
    explanation:
      "Empress Taytu chose the site of the Filwoha hot springs and named the new city Addis Ababa ('New Flower'); it became the permanent capital.",
  },
  {
    id: "his-23",
    subjectSlug: "history",
    topic: "Modern Ethiopia — Haile Selassie I",
    stem: "Which modernizing document did Emperor Haile Selassie I introduce in 1931?",
    options: [
      "Ethiopia's first written constitution",
      "the first national census",
      "the Treaty of Wuchale",
      "the land nationalization proclamation",
    ],
    answer: "A",
    explanation:
      "The 1931 constitution created the first written framework of government, including an appointed parliament; it was revised in 1955.",
  },
  {
    id: "his-24",
    subjectSlug: "history",
    topic: "Modern Ethiopia — Italian Invasion",
    stem: "Fascist Italy launched its full-scale invasion of Ethiopia on:",
    options: ["1 March 1896", "3 October 1935", "19 February 1937", "27 November 1941"],
    answer: "B",
    explanation:
      "On 3 October 1935 Italy invaded from Eritrea and Somalia without declaring war; Addis Ababa fell in May 1936, beginning five years of occupation.",
  },
  {
    id: "his-25",
    subjectSlug: "history",
    topic: "Modern Ethiopia — Italian Occupation",
    stem: "The 'Yekatit 12' massacre of February 1937 followed an assassination attempt against which Italian viceroy?",
    options: ["Rodolfo Graziani", "Pietro Badoglio", "Oreste Baratieri", "Emilio De Bono"],
    answer: "A",
    explanation:
      "After two Eritrean patriots tried to kill Viceroy Graziani on Yekatit 12 (19 February 1937), Italian forces massacred thousands of civilians in Addis Ababa.",
  },
  {
    id: "his-26",
    subjectSlug: "history",
    topic: "Modern Ethiopia — Liberation",
    stem: "Ethiopia's independence was restored in 1941 after five years of patriotic resistance. The last Italian stronghold to fall was:",
    options: ["Gondar", "Addis Ababa", "Harar", "Jimma"],
    answer: "A",
    explanation:
      "Patriot fighters (Arbegnoch) together with Allied forces liberated most of the country in 1941; Gondar, the last Italian fortress, fell in November 1941.",
  },
  {
    id: "his-27",
    subjectSlug: "history",
    topic: "Modern Ethiopia — International Relations",
    stem: "In June 1936 Emperor Haile Selassie I appealed to the League of Nations in Geneva after Italy's invasion. The failure of the League to stop the aggression is chiefly remembered as:",
    options: [
      "a fatal blow to the credibility of collective security",
      "the beginning of the United Nations",
      "the start of the Cold War",
      "the reason Ethiopia joined the Axis",
    ],
    answer: "A",
    explanation:
      "The League's weak sanctions failed to save Ethiopia, exposing collective security as ineffective — a milestone on the road to World War II.",
  },
  {
    id: "his-28",
    subjectSlug: "history",
    topic: "Modern Ethiopia — Federation",
    stem: "The federation between Ethiopia and Eritrea, arranged by the United Nations, took effect in:",
    options: ["1896", "1936", "1952", "1993"],
    answer: "C",
    explanation:
      "UN Resolution 390(A) federated Eritrea with Ethiopia effective September 1952; the federation was dissolved in 1962 and Eritrea became independent in 1993.",
  },
  {
    id: "his-29",
    subjectSlug: "history",
    topic: "International Organizations",
    stem: "Addis Ababa became the permanent headquarters of which organization at its founding in 1963?",
    options: [
      "the Organization of African Unity (OAU)",
      "the United Nations",
      "the Non-Aligned Movement",
      "the World Trade Organization",
    ],
    answer: "A",
    explanation:
      "The OAU was founded in Addis Ababa on 25 May 1963, largely through the diplomacy of Emperor Haile Selassie I; its successor, the African Union, kept the same headquarters.",
  },
  {
    id: "his-30",
    subjectSlug: "history",
    topic: "1974 Revolution — Causes",
    stem: "Which immediate crisis of 1973–74 discredited the imperial government and helped trigger the Ethiopian Revolution?",
    options: [
      "the Wollo famine, hidden from the public while officials celebrated",
      "a foreign military invasion",
      "the collapse of the birr currency",
      "a nationwide teachers' strike over pensions",
    ],
    answer: "A",
    explanation:
      "The 1973 Wollo famine, exposed by journalists and students while the government denied it, ignited the discontent that produced the February 1974 uprising.",
  },
  {
    id: "his-31",
    subjectSlug: "history",
    topic: "The Derg",
    stem: "The 'Derg', which seized power after the 1974 Revolution, was officially:",
    options: [
      "the Coordinating Committee of the Armed Forces, Police and Territorial Army",
      "a parliament elected in 1974",
      "the political wing of the EPRP",
      "a council of regional princes",
    ],
    answer: "A",
    explanation:
      "The Derg was the committee of military and police units that first deposed Haile Selassie in September 1974 and later ruled under Mengistu Haile Mariam.",
  },
  {
    id: "his-32",
    subjectSlug: "history",
    topic: "The Derg — Land Reform",
    stem: "The Derg's March 1975 Proclamation No. 31 nationalized rural land under which slogan?",
    options: ["'Land to the Tiller'", "'Back to the Land'", "'Land for the Nobles'", "'Green Legacy'"],
    answer: "A",
    explanation:
      "The 1975 land proclamation abolished tenancy and distributed use rights to peasants, responding to the popular demand 'land to the tiller'.",
  },
  {
    id: "his-33",
    subjectSlug: "history",
    topic: "The Derg — Red Terror",
    stem: "The 'Red Terror' campaign of 1977–78 was directed by the Derg mainly against:",
    options: [
      "opposition movements such as the EPRP and their suspected supporters",
      "foreign mercenaries",
      "members of the imperial family only",
      "civil servants who refused pay cuts",
    ],
    answer: "A",
    explanation:
      "During the Red Terror the Derg's security forces killed tens of thousands of suspected members and sympathizers of the EPRP and other opposition groups.",
  },
  {
    id: "his-34",
    subjectSlug: "history",
    topic: "Fall of the Derg",
    stem: "The Derg government collapsed in May 1991 when forces of which coalition entered Addis Ababa?",
    options: ["the EPRDF", "the OAU peacekeepers", "the United Nations mission", "the Mahdist army"],
    answer: "A",
    explanation:
      "On 28 May 1991 the Ethiopian People's Revolutionary Democratic Front (EPRDF) took Addis Ababa and Mengistu fled into exile.",
  },
  {
    id: "his-35",
    subjectSlug: "history",
    topic: "Post-1991 Ethiopia",
    stem: "Eritrea became an independent state after a UN-supervised referendum held in:",
    options: ["1991", "1993", "1995", "1998"],
    answer: "B",
    explanation:
      "Eritreans voted overwhelmingly for independence in April 1993, and the new state was admitted to the UN in May 1993.",
  },
  {
    id: "his-36",
    subjectSlug: "history",
    topic: "Post-1991 Ethiopia — Constitution",
    stem: "The Constitution of the Federal Democratic Republic of Ethiopia, which established the current federal structure, came into force in:",
    options: ["1931", "1955", "1987", "1995"],
    answer: "D",
    explanation:
      "The FDRE Constitution was adopted in December 1994 and came into force in August 1995, creating a federal state of regional states with a two-chamber parliament.",
  },
  {
    id: "his-37",
    subjectSlug: "history",
    topic: "World History — French Revolution",
    stem: "The storming of the Bastille, the symbolic beginning of the French Revolution, occurred in:",
    options: ["1776", "1789", "1815", "1848"],
    answer: "B",
    explanation:
      "On 14 July 1789 Parisians stormed the Bastille prison; the revolution's ideals of liberty, equality and fraternity reshaped world politics.",
  },
  {
    id: "his-38",
    subjectSlug: "history",
    topic: "World History — Industrial Revolution",
    stem: "The Industrial Revolution began in the mid-eighteenth century in which country, transformed by inventions such as James Watt's improved steam engine?",
    options: ["France", "Britain", "the United States", "Germany"],
    answer: "B",
    explanation:
      "Britain's coal, colonies, capital and inventions — Watt's steam engine above all — made it the birthplace of factory-based industrial production.",
  },
  {
    id: "his-39",
    subjectSlug: "history",
    topic: "World History — World War I",
    stem: "World War I (1914–1918) was triggered by the assassination in Sarajevo of:",
    options: [
      "Archduke Franz Ferdinand of Austria",
      "King George V of Britain",
      "Tsar Nicholas II of Russia",
      "President Woodrow Wilson",
    ],
    answer: "A",
    explanation:
      "Gavrilo Princip shot Archduke Franz Ferdinand in June 1914; the alliance system then dragged the great powers into four years of war.",
  },
  {
    id: "his-40",
    subjectSlug: "history",
    topic: "World History — Russian Revolution",
    stem: "The Bolshevik seizure of power in Russia in October 1917 was led by:",
    options: ["Vladimir Lenin", "Joseph Stalin", "Leon Trotsky alone", "Tsar Nicholas II"],
    answer: "A",
    explanation:
      "Lenin's Bolsheviks overthrew the Provisional Government in October 1917 and created the first socialist state, the USSR.",
  },
  {
    id: "his-41",
    subjectSlug: "history",
    topic: "World History — World War II",
    stem: "The United Nations was founded in 1945 immediately after which event?",
    options: ["the end of World War II", "the Russian Revolution", "the fall of the Berlin Wall", "the founding of the OAU"],
    answer: "A",
    explanation:
      "The UN Charter took effect on 24 October 1945, as the world sought a stronger successor to the failed League of Nations.",
  },
  {
    id: "his-42",
    subjectSlug: "history",
    topic: "World History — Cold War",
    stem: "The Cold War rivalry between the Western bloc and the Eastern bloc was symbolized by rival alliances founded in 1949 and 1955. These were:",
    options: [
      "NATO and the Warsaw Pact",
      "the UN and the League of Nations",
      "the EEC and COMECON",
      "the OAU and the Arab League",
    ],
    answer: "A",
    explanation:
      "NATO (1949) united the Western democracies; the Warsaw Pact (1955) answered it for the Soviet bloc, formalizing Europe's division.",
  },
  {
    id: "his-43",
    subjectSlug: "history",
    topic: "World History — End of the Cold War",
    stem: "The fall of the Berlin Wall in November 1989 is best remembered as:",
    options: [
      "the symbolic end of the Cold War division of Europe",
      "the start of World War II",
      "the founding of the Warsaw Pact",
      "the beginning of decolonization",
    ],
    answer: "A",
    explanation:
      "The Wall's collapse on 9 November 1989 opened the way for German reunification and the dissolution of the Soviet bloc.",
  },
  {
    id: "his-44",
    subjectSlug: "history",
    topic: "African Independence",
    stem: "Ghana's independence in 1957, led by Kwame Nkrumah, is celebrated because Ghana became:",
    options: [
      "the first sub-Saharan African country to gain independence from colonial rule",
      "the richest country in Africa",
      "the first African member of the UN Security Council",
      "the founder of the Warsaw Pact",
    ],
    answer: "A",
    explanation:
      "Ghana's peaceful transition from British rule in 1957 inspired liberation movements across the continent.",
  },
  {
    id: "his-45",
    subjectSlug: "history",
    topic: "African Independence — South Africa",
    stem: "Nelson Mandela, imprisoned for 27 years for resisting apartheid, became President of South Africa in:",
    options: ["1990", "1994", "1998", "2001"],
    answer: "B",
    explanation:
      "Mandela was released in February 1990, negotiated the end of apartheid, and won South Africa's first democratic election in 1994.",
  },

  // ── GEOGRAPHY (45: 5 original + 40 verified expansion) ───────────────
  {
    id: "geo-01",
    subjectSlug: "geography",
    topic: "Ethiopian Landforms",
    stem: "What is the highest mountain peak in Ethiopia?",
    options: ["Mount Tolu", "Ras Dashen", "Mount Batu", "Abuna Yosef"],
    answer: "B",
    explanation: "Ras Dashen (about 4,550 m) in the Simien Mountains is Ethiopia's highest peak.",
  },
  {
    id: "geo-02",
    subjectSlug: "geography",
    topic: "Ethiopian Water Resources",
    stem: "Which is the largest lake in Ethiopia?",
    options: ["Lake Abaya", "Lake Chamo", "Lake Tana", "Lake Ziway"],
    answer: "C",
    explanation:
      "Lake Tana in the northwest highlands is Ethiopia's largest lake and the main source of the Blue Nile.",
  },
  {
    id: "geo-03",
    subjectSlug: "geography",
    topic: "World Geography",
    stem: "The Suez Canal connects the Mediterranean Sea with the:",
    options: ["Black Sea", "Red Sea", "Arabian Sea", "Atlantic Ocean"],
    answer: "B",
    explanation: "The Suez Canal (Egypt) links the Mediterranean and the Red Sea, separating Africa from Asia.",
  },
  {
    id: "geo-04",
    subjectSlug: "geography",
    topic: "Earth and Map Skills",
    stem: "What is the name of the imaginary line at 0° latitude?",
    options: ["the Prime Meridian", "the Equator", "the Tropic of Cancer", "the International Date Line"],
    answer: "B",
    explanation:
      "The Equator is 0° latitude and divides Earth into Northern and Southern hemispheres. The Prime Meridian is 0° longitude.",
  },
  {
    id: "geo-05",
    subjectSlug: "geography",
    topic: "Climate of Ethiopia",
    stem: "Which Ethiopian lowland is famous as one of the hottest inhabited places on Earth?",
    options: ["the Ogaden lowlands", "the Danakil (Afar) Depression", "the Gambella plains", "the Baro lowlands"],
    answer: "B",
    explanation:
      "The Danakil Depression sits about 125 m below sea level and regularly records among the highest annual temperatures on Earth.",
  },

  // ── GEOGRAPHY EXPANSION (geo-06 … geo-45) — Ethiopia, Africa and map
  //    skills. Human-authored for Learnyx, curriculum-aligned, settled
  //    and uncontested facts only. Appended AFTER geo-05 so the
  //    (contentId, questionNumber) upsert mapping stays stable.
  {
    id: "geo-06",
    subjectSlug: "geography",
    topic: "Location and Size of Ethiopia",
    stem: "Ethiopia lies entirely within which hemisphere?",
    options: ["the Northern Hemisphere", "the Southern Hemisphere", "the Western Hemisphere", "the Eastern and Western Hemispheres"],
    answer: "A",
    explanation:
      "Ethiopia extends roughly from 3°N to 15°N latitude, so the whole country lies north of the Equator in the Northern Hemisphere.",
  },
  {
    id: "geo-07",
    subjectSlug: "geography",
    topic: "Location and Size of Ethiopia",
    stem: "After the independence of Eritrea in 1993, Ethiopia became:",
    options: [
      "the most populous landlocked country in the world",
      "an island state",
      "a federation of coastal states",
      "the largest country in Africa by area",
    ],
    answer: "A",
    explanation:
      "Ethiopia lost its coastline in 1993 and is now the world's most populous landlocked country, relying mainly on the Djibouti corridor for sea trade.",
  },
  {
    id: "geo-08",
    subjectSlug: "geography",
    topic: "Ethiopian Relief",
    stem: "The highest peak in Ethiopia, Ras Dashen (about 4,550 m), is found in which mountain massif?",
    options: ["the Semien (Simien) Mountains", "the Bale Mountains", "the Chercher Mountains", "the Guge Mountains"],
    answer: "A",
    explanation:
      "Ras Dashen rises in the Semien Mountains of northwestern Ethiopia, part of the vast highland massif formed by volcanic uplift and erosion.",
  },
  {
    id: "geo-09",
    subjectSlug: "geography",
    topic: "Ethiopian Relief",
    stem: "Ethiopia is often called the 'Roof of Africa' because:",
    options: [
      "more than half of its area lies above about 1,500 m altitude",
      "it has the tallest volcano in the world",
      "it is covered by permanent snow",
      "it has Africa's largest desert",
    ],
    answer: "A",
    explanation:
      "The Ethiopian Highlands cover most of the country and include Africa's largest continuous area of land above 1,500 m — hence the nickname.",
  },
  {
    id: "geo-10",
    subjectSlug: "geography",
    topic: "The Rift Valley",
    stem: "The Ethiopian Rift Valley, which splits the highlands into the northwestern and southeastern plateaus, is part of:",
    options: [
      "the Great Rift Valley system running from the Red Sea down to Mozambique",
      "the Mid-Atlantic Ridge",
      "the Himalayan fold belt",
      "the Andean trench system",
    ],
    answer: "A",
    explanation:
      "Ethiopia sits on the Great Rift Valley, a divergent plate boundary where the African Plate is slowly splitting apart — the cause of the region's faults, lakes and volcanoes.",
  },
  {
    id: "geo-11",
    subjectSlug: "geography",
    topic: "Volcanism",
    stem: "Erta Ale, famous for its persistent lava lake, is an active volcano located in:",
    options: ["the Danakil (Afar) Depression", "the Bale Mountains", "the Gondar highlands", "the Ilubabor forests"],
    answer: "A",
    explanation:
      "Erta Ale lies in the Danakil Depression, one of the hottest places on Earth, where rifting brings magma close to the surface.",
  },
  {
    id: "geo-12",
    subjectSlug: "geography",
    topic: "Ethiopian Climate — Seasons",
    stem: "In Ethiopia, the main rainy season (kiremt), which brings most of the country's rainfall, lasts roughly from:",
    options: ["June to September", "October to January", "February to May", "December to February"],
    answer: "A",
    explanation:
      "Kiremt (June–September) is driven by the northward shift of the ITCZ and supplies most agricultural water; belg (Feb–May) brings shorter rains, and bega (Oct–Jan) is mostly dry.",
  },
  {
    id: "geo-13",
    subjectSlug: "geography",
    topic: "Ethiopian Climate — Altitude Zones",
    stem: "In Ethiopian traditional climate classification, the cool temperate zone called 'dega' lies at approximately:",
    options: [
      "2,500–3,200 m above sea level",
      "sea level to 500 m",
      "500–1,500 m",
      "above 3,700 m only",
    ],
    answer: "A",
    explanation:
      "Dega (roughly 2,500–3,200 m) has cool temperatures; below it lies woina dega (temperate, 1,500–2,500 m) and kolla (hot lowlands), with wurch above it.",
  },
  {
    id: "geo-14",
    subjectSlug: "geography",
    topic: "Ethiopian Climate — Altitude Zones",
    stem: "Why do the Ethiopian Highlands enjoy mild temperatures despite lying close to the Equator?",
    options: [
      "because temperature decreases with altitude — about 6.5 °C per 1,000 m",
      "because cold ocean currents reach the highlands",
      "because of thick permanent cloud cover all year",
      "because of their polar latitude",
    ],
    answer: "A",
    explanation:
      "Altitude, not latitude, controls Ethiopian temperatures: the normal lapse rate cools the air roughly 6.5 °C for every 1,000 m of elevation.",
  },
  {
    id: "geo-15",
    subjectSlug: "geography",
    topic: "Drainage Systems of Ethiopia",
    stem: "Which river, rising from Lake Tana, is the largest single contributor to the flow of the Nile?",
    options: ["the Abay (Blue Nile)", "the Awash", "the Omo", "the Genale"],
    answer: "A",
    explanation:
      "The Abay (Blue Nile) leaves Lake Tana and, joined by the Tekeze–Atbara system, supplies the majority of the Nile's water reaching Sudan and Egypt.",
  },
  {
    id: "geo-16",
    subjectSlug: "geography",
    topic: "Drainage Systems of Ethiopia",
    stem: "Which Ethiopian river flows eastward and terminates in the Lake Abe (Abhe) basin on the Djibouti border without reaching the sea?",
    options: ["the Awash", "the Baro", "the Wabi Shebele", "the Mereb"],
    answer: "A",
    explanation:
      "The Awash is an interior-draining river: it never reaches the ocean and ends in the chain of lakes around Lake Abe in the Afar region.",
  },
  {
    id: "geo-17",
    subjectSlug: "geography",
    topic: "Drainage Systems of Ethiopia",
    stem: "The Omo River drains the southwestern Ethiopian highlands and empties into:",
    options: ["Lake Turkana", "Lake Tana", "the Gulf of Aden", "Lake Victoria"],
    answer: "A",
    explanation:
      "The Omo flows south into Lake Turkana (Kenya), making the Omo–Turkana basin a closed interior drainage system.",
  },
  {
    id: "geo-18",
    subjectSlug: "geography",
    topic: "Lakes of Ethiopia",
    stem: "The largest lake in Ethiopia is:",
    options: ["Lake Tana", "Lake Abaya", "Lake Chamo", "Lake Ziway"],
    answer: "A",
    explanation:
      "Lake Tana in the northwestern highlands is Ethiopia's largest lake and the source of the Abay (Blue Nile).",
  },
  {
    id: "geo-19",
    subjectSlug: "geography",
    topic: "Lakes of Ethiopia",
    stem: "Most of Ethiopia's Rift Valley lakes (Ziway, Langano, Shala, Abijatta) share which important characteristic?",
    options: [
      "they lie in a closed basin chain formed by rifting and faulting",
      "they are all crater lakes on mountain tops",
      "they all drain into the Nile",
      "they are all salt-dome sinkholes",
    ],
    answer: "A",
    explanation:
      "Rift faulting created a chain of lakes in closed basins; some are fresh (Ziway, Langano) and some saline (Shala, Abijatta) because they have no outlet.",
  },
  {
    id: "geo-20",
    subjectSlug: "geography",
    topic: "Vegetation of Ethiopia",
    stem: "The Afro-alpine vegetation of giant lobelia and 'guassa' grass is found in Ethiopia:",
    options: [
      "above about 3,200 m on the highest mountains such as the Semien and Bale",
      "in the Danakil salt flats",
      "along the whole Red Sea coast",
      "only in Gambella's lowland grasslands",
    ],
    answer: "A",
    explanation:
      "Afro-alpine moorland survives frosty nights on the highest plateaus and peaks — a distinctive ecosystem of Eastern Africa's giant mountains.",
  },
  {
    id: "geo-21",
    subjectSlug: "geography",
    topic: "Wildlife and Conservation",
    stem: "The walia ibex, an Ethiopian endemic mountain goat, survives today mainly in:",
    options: [
      "the Semien Mountains National Park",
      "Awash National Park",
      "Nechisar National Park",
      "the Omo National Park",
    ],
    answer: "A",
    explanation:
      "The walia ibex is confined to the cliffs of the Semien Mountains, a UNESCO World Heritage Site protecting this and other endemic species.",
  },
  {
    id: "geo-22",
    subjectSlug: "geography",
    topic: "Wildlife and Conservation",
    stem: "The Ethiopian wolf (Simien fox), the world's rarest canid, is concentrated in which highland area?",
    options: ["the Bale Mountains", "the Ogaden desert", "Lake Tana islands", "the Dire Dawa escarpments"],
    answer: "A",
    explanation:
      "The Bale Mountains' Afro-alpine moorlands hold the largest remaining population of the endangered Ethiopian wolf.",
  },
  {
    id: "geo-23",
    subjectSlug: "geography",
    topic: "Wildlife and Conservation",
    stem: "The gelada baboon, found only in the Ethiopian highlands, is notable because it:",
    options: [
      "grazes on grass and lives in large troops on the Semien escarpments",
      "lives in the Danakil salt pans",
      "is an aquatic primate of Lake Tana",
      "migrates yearly to Yemen",
    ],
    answer: "A",
    explanation:
      "Geladas are grass-eating monkeys unique to Ethiopia's high gorges — the last survivors of a once widespread grazing-primate lineage.",
  },
  {
    id: "geo-24",
    subjectSlug: "geography",
    topic: "Population of Ethiopia",
    stem: "Ethiopia's population is characterized by:",
    options: [
      "a very young age structure and a predominantly rural settlement pattern",
      "a declining population",
      "an equal urban–rural distribution",
      "an aging, shrinking labor force",
    ],
    answer: "A",
    explanation:
      "Ethiopia has one of the world's youngest populations and a predominantly rural, highland-concentrated settlement pattern.",
  },
  {
    id: "geo-25",
    subjectSlug: "geography",
    topic: "Population of Ethiopia",
    stem: "In Ethiopia, population density is generally highest in:",
    options: [
      "the well-watered mid-altitude (woina dega) highlands",
      "the hot Danakil salt flats",
      "the Ogaden desert",
      "the Borena semi-desert",
    ],
    answer: "A",
    explanation:
      "Fertile volcanic soils, reliable kiremt rains and disease-free cool climate make the mid-highlands Ethiopia's historic population core.",
  },
  {
    id: "geo-26",
    subjectSlug: "geography",
    topic: "Economic Activities — Agriculture",
    stem: "Which crop, domesticated in the southwestern Ethiopian highlands, remains the country's largest export earner?",
    options: ["coffee", "wheat", "cotton", "sugarcane"],
    answer: "A",
    explanation:
      "Coffee, first cultivated in the Kaffa highlands, is Ethiopia's leading export and the backbone of smallholder cash income.",
  },
  {
    id: "geo-27",
    subjectSlug: "geography",
    topic: "Economic Activities — Agriculture",
    stem: "Teff, the tiny grain used to bake injera, is notable because it:",
    options: [
      "is indigenous (endemic) to Ethiopia and almost nowhere else grown as a staple",
      "was introduced by Italian colonists",
      "grows only under irrigation in the Afar Depression",
      "is the country's main export to Europe",
    ],
    answer: "A",
    explanation:
      "Teff was domesticated in the Ethiopian highlands and remains the staple cereal of the national dish, injera.",
  },
  {
    id: "geo-28",
    subjectSlug: "geography",
    topic: "Economic Activities — Agriculture",
    stem: "Enset (the 'false banana') is a drought-tolerant staple that anchors food security chiefly in:",
    options: [
      "the south and southwestern highlands (e.g., Sidama, Gamo, Hadiya areas)",
      "the Afar lowlands",
      "the Ogaden rangelands",
      "the Humera sesame belt",
    ],
    answer: "A",
    explanation:
      "Enset's carbohydrate-rich pseudostem tolerates dry spells, making it the classic 'tree against hunger' of southern Ethiopian farming systems.",
  },
  {
    id: "geo-29",
    subjectSlug: "geography",
    topic: "Economic Activities — Livestock",
    stem: "Ethiopia ranks among the first in Africa in:",
    options: [
      "cattle population",
      "offshore fishing",
      "deep-sea shipping",
      "iron ore production",
    ],
    answer: "A",
    explanation:
      "With tens of millions of cattle, sheep and goats, Ethiopia has one of the largest livestock populations in Africa, supporting both food and export sectors.",
  },
  {
    id: "geo-30",
    subjectSlug: "geography",
    topic: "Energy Resources",
    stem: "The Grand Ethiopian Renaissance Dam (GERD), Africa's largest hydropower plant, is being built on which river?",
    options: ["the Abay (Blue Nile)", "the Awash", "the Omo", "the Genale"],
    answer: "A",
    explanation:
      "GERD stands on the Abay (Blue Nile) in the Benishangul-Gumuz region and is designed to transform Ethiopia's electricity supply.",
  },
  {
    id: "geo-31",
    subjectSlug: "geography",
    topic: "Transport and Trade",
    stem: "Since losing its coastline, the great majority of Ethiopia's import–export trade passes through the port of:",
    options: ["Djibouti", "Mombasa", "Port Sudan", "Berbera only"],
    answer: "A",
    explanation:
      "The Addis Ababa–Djibouti corridor, now served by an electrified standard-gauge railway, carries most of Ethiopia's maritime trade.",
  },
  {
    id: "geo-32",
    subjectSlug: "geography",
    topic: "Regions of Ethiopia",
    stem: "Sidama became a new regional state of Ethiopia in 2020 after:",
    options: [
      "a referendum in which its people voted for statehood",
      "a decision of the OAU",
      "a treaty with Eritrea",
      "a court ruling in Addis Ababa",
    ],
    answer: "A",
    explanation:
      "The Sidama Zone of the SNNPR held a referendum in November 2019 (statehood declared 2020) and became a new regional state under the constitutional right to secede from a region.",
  },
  {
    id: "geo-33",
    subjectSlug: "geography",
    topic: "Africa — Physical Features",
    stem: "The White Nile and the Blue Nile merge to form the single Nile River at:",
    options: ["Khartoum, Sudan", "Cairo, Egypt", "Lake Victoria", "Aswan, Egypt"],
    answer: "A",
    explanation:
      "At Khartoum the White Nile (from the equatorial lakes) meets the Blue Nile (from Ethiopia); the Atbara is the last major tributary downstream.",
  },
  {
    id: "geo-34",
    subjectSlug: "geography",
    topic: "Africa — Physical Features",
    stem: "Africa's highest mountain, Kilimanjaro (5,895 m), lies in:",
    options: ["Tanzania, near the Kenyan border", "Ethiopia", "Uganda", "Kenya"],
    answer: "A",
    explanation:
      "Kilimanjaro's glaciated volcanic cone rises in northeastern Tanzania just south of Kenya.",
  },
  {
    id: "geo-35",
    subjectSlug: "geography",
    topic: "Africa — Physical Features",
    stem: "The largest lake in Africa, shared by Uganda, Kenya and Tanzania, is:",
    options: ["Lake Victoria", "Lake Tana", "Lake Chad", "Lake Malawi"],
    answer: "A",
    explanation:
      "Lake Victoria is Africa's largest lake by area and the chief reservoir of the White Nile.",
  },
  {
    id: "geo-36",
    subjectSlug: "geography",
    topic: "Africa — Climate",
    stem: "The Sahel is the semi-arid transition belt that lies:",
    options: [
      "between the Sahara Desert to the north and the wetter savannas to the south",
      "along the Mediterranean coast",
      "inside the equatorial rainforest",
      "in Southern Africa's Cape ranges",
    ],
    answer: "A",
    explanation:
      "The Sahel ('shore' of the desert) stretches across Africa south of the Sahara, where rainfall is marginal and droughts are recurrent.",
  },
  {
    id: "geo-37",
    subjectSlug: "geography",
    topic: "Map Skills — Scale",
    stem: "On a map with a scale of 1:50,000, a distance of 2 centimeters on the map represents what real-world distance?",
    options: ["1 kilometer", "100 meters", "10 kilometers", "50 kilometers"],
    answer: "A",
    explanation:
      "1:50,000 means 1 cm = 50,000 cm = 0.5 km; therefore 2 cm = 1 km.",
  },
  {
    id: "geo-38",
    subjectSlug: "geography",
    topic: "Map Skills — Contours",
    stem: "On a topographic map, contour lines that are drawn very close together indicate:",
    options: [
      "a steep slope",
      "a flat plain",
      "a deep ocean trench",
      "a straight river course",
    ],
    answer: "A",
    explanation:
      "Closely spaced contours mean elevation changes rapidly over a short horizontal distance — a steep gradient; widely spaced contours mark gentle terrain.",
  },
  {
    id: "geo-39",
    subjectSlug: "geography",
    topic: "Map Skills — Direction",
    stem: "A person facing north turns 90° clockwise, then 90° clockwise again. Which direction is the person now facing?",
    options: ["south", "east", "west", "north"],
    answer: "A",
    explanation:
      "From north, one 90° clockwise turn faces east; a second turn faces south.",
  },
  {
    id: "geo-40",
    subjectSlug: "geography",
    topic: "Time Zones",
    stem: "Ethiopia uses East Africa Time (EAT), which is how many hours ahead of Greenwich Mean Time (GMT/UTC)?",
    options: ["3 hours", "1 hour", "5 hours", "8 hours"],
    answer: "A",
    explanation:
      "Ethiopia lies near 45°E longitude and keeps UTC+3, three hours ahead of Greenwich.",
  },
  {
    id: "geo-41",
    subjectSlug: "geography",
    topic: "Weathering and Erosion",
    stem: "The deep gorges cut by the Abay and Tekeze rivers through the Ethiopian Plateau are the result of:",
    options: [
      "river (fluvial) erosion — vertical down-cutting as the plateau uplifted",
      "glacial scouring during the Ice Age",
      "wind abrasion by desert sands",
      "human quarrying",
    ],
    answer: "A",
    explanation:
      "As the highlands uplifted, powerful rivers cut steep gorges hundreds of meters deep — classic fluvial erosion at work.",
  },
  {
    id: "geo-42",
    subjectSlug: "geography",
    topic: "Soils of Ethiopia",
    stem: "The fertile dark clay soils (Vertisols) of the Ethiopian highlands are prized for agriculture but are difficult to cultivate because they:",
    options: [
      "become waterlogged and sticky in the wet season and crack hard when dry",
      "are too salty for any crop",
      "contain toxic volcanic ash",
      "erode into sand dunes",
    ],
    answer: "A",
    explanation:
      "Vertisols swell shut when wet and crack when dry; drainage techniques such as broad bed and furrows were developed to farm them.",
  },
  {
    id: "geo-43",
    subjectSlug: "geography",
    topic: "Environmental Issues",
    stem: "Deforestation on the Ethiopian highlands most directly leads to:",
    options: [
      "severe soil erosion and loss of fertile topsoil",
      "an increase in mountain snowfall",
      "the expansion of glaciers",
      "rising sea levels on the Red Sea",
    ],
    answer: "A",
    explanation:
      "Without tree roots to bind the soil, highland rains wash away topsoil — reducing fertility and silting dams; soil conservation terracing is a major response.",
  },
  {
    id: "geo-44",
    subjectSlug: "geography",
    topic: "Remote Sensing and GIS",
    stem: "Satellite images and aerial photographs used to study land cover from a distance are known collectively as:",
    options: ["remote sensing", "cartography", "contouring", "triangulation"],
    answer: "A",
    explanation:
      "Remote sensing gathers information about the Earth without touching it — the basis of modern land-cover mapping and drought early-warning in Ethiopia.",
  },
  {
    id: "geo-45",
    subjectSlug: "geography",
    topic: "Ethiopia — Neighbors",
    stem: "Which of the following countries does NOT share a border with Ethiopia?",
    options: ["Uganda", "Kenya", "Somalia", "Sudan"],
    answer: "A",
    explanation:
      "Ethiopia borders Eritrea, Djibouti, Somalia, Kenya, South Sudan and Sudan — Uganda lies one country away, across Kenya.",
  },

  // ── ECONOMICS (45: 5 original + 40 verified expansion) ───────────────
  {
    id: "eco-01",
    subjectSlug: "economics",
    topic: "Foundations of Economics",
    stem: "What is the basic economic problem all societies face?",
    options: ["inflation", "unemployment", "scarcity", "trade deficits"],
    answer: "C",
    explanation:
      "Resources are limited while human wants are unlimited — scarcity — which forces societies to make choices about production and distribution.",
  },
  {
    id: "eco-02",
    subjectSlug: "economics",
    topic: "Opportunity Cost",
    stem: "What does “opportunity cost” mean?",
    options: [
      "the money price of a good",
      "the value of the next best alternative given up when a choice is made",
      "the total cost of production",
      "the profit a firm earns",
    ],
    answer: "B",
    explanation:
      "Every choice sacrifices alternatives; the opportunity cost is the value of the best alternative forgone.",
  },
  {
    id: "eco-03",
    subjectSlug: "economics",
    topic: "Demand",
    stem: "According to the law of demand, when the price of a good rises (all else equal), the quantity demanded:",
    options: ["rises", "falls", "stays the same", "doubles"],
    answer: "B",
    explanation:
      "Price and quantity demanded move in opposite directions, so the demand curve slopes downward from left to right.",
  },
  {
    id: "eco-04",
    subjectSlug: "economics",
    topic: "Macroeconomics — Price Level",
    stem: "Inflation is best described as:",
    options: [
      "a one-time fall in the price of oil",
      "a sustained rise in the general price level",
      "an increase in national income",
      "a rise in the unemployment rate",
    ],
    answer: "B",
    explanation:
      "Inflation is a persistent increase in the overall price level, which reduces the purchasing power of money.",
  },
  {
    id: "eco-05",
    subjectSlug: "economics",
    topic: "National Income",
    stem: "GDP (Gross Domestic Product) measures:",
    options: [
      "the total value of final goods and services produced within a country in a given period",
      "a country's total exports",
      "the government's total spending",
      "the money supply in circulation",
    ],
    answer: "A",
    explanation:
      "GDP sums the market value of all final goods and services produced inside a country's borders in a period (usually a year).",
  },

  // ── ECONOMICS EXPANSION (eco-06 … eco-45) — Micro, macro, money and the
  //    Ethiopian economy. Human-authored for Learnyx, curriculum-aligned,
  //    standard textbook theory and settled facts only. Appended AFTER
  //    eco-05 so the (contentId, questionNumber) upsert mapping stays stable.
  {
    id: "eco-06",
    subjectSlug: "economics",
    topic: "Scarcity and Choice",
    stem: "The fundamental economic problem that gives rise to choice is:",
    options: ["scarcity — limited resources against unlimited wants", "inflation", "unemployment", "foreign debt"],
    answer: "A",
    explanation:
      "Because resources are limited while human wants are unlimited, individuals and societies must choose — which is why economics exists.",
  },
  {
    id: "eco-07",
    subjectSlug: "economics",
    topic: "Opportunity Cost",
    stem: "A student gives up a 500 birr/day part-time job to attend a full-day training that costs 200 birr in fees. The opportunity cost of attending the training is:",
    options: ["700 birr", "200 birr", "500 birr", "300 birr"],
    answer: "A",
    explanation:
      "Opportunity cost = the value of the next best alternative given up (500 birr of wages) plus the direct cost paid (200 birr) = 700 birr.",
  },
  {
    id: "eco-08",
    subjectSlug: "economics",
    topic: "Production Possibility Frontier",
    stem: "A production possibility frontier (PPF) that bows outward (concave to the origin) illustrates:",
    options: [
      "increasing opportunity cost as more of one good is produced",
      "constant opportunity cost",
      "decreasing opportunity cost",
      "that both goods are free",
    ],
    answer: "A",
    explanation:
      "Resources are not equally suited to both goods, so shifting production costs more and more of the other good — the law of increasing opportunity cost.",
  },
  {
    id: "eco-09",
    subjectSlug: "economics",
    topic: "Factors of Production",
    stem: "Which factor of production earns RENT as its reward?",
    options: ["land", "labor", "capital", "entrepreneurship"],
    answer: "A",
    explanation:
      "In classical factor-payment terms: land earns rent, labor earns wages, capital earns interest, and entrepreneurship earns profit.",
  },
  {
    id: "eco-10",
    subjectSlug: "economics",
    topic: "Economic Systems",
    stem: "An economic system in which resources are allocated mainly by the price mechanism and private ownership dominates is called:",
    options: ["a free market (capitalist) economy", "a command economy", "a traditional economy", "a subsistence economy"],
    answer: "A",
    explanation:
      "In a market economy, prices set by supply and demand coordinate decisions; in a command economy the state allocates resources, and Ethiopia follows a mixed system.",
  },
  {
    id: "eco-11",
    subjectSlug: "economics",
    topic: "Demand",
    stem: "The law of demand states that, other things being equal:",
    options: [
      "as price rises, quantity demanded falls",
      "as price rises, quantity demanded rises",
      "price and demand are unrelated",
      "demand depends only on income",
    ],
    answer: "A",
    explanation:
      "The law of demand captures the inverse relationship between price and quantity demanded — the demand curve slopes downward.",
  },
  {
    id: "eco-12",
    subjectSlug: "economics",
    topic: "Demand — Shifts vs Movements",
    stem: "A rise in consumers' incomes shifts the demand curve for a normal good:",
    options: [
      "to the right (more demanded at every price)",
      "to the left",
      "not at all — income changes only move along the curve",
      "vertically downward",
    ],
    answer: "A",
    explanation:
      "Income changes are a non-price determinant: for a normal good, higher income increases demand at every price, shifting the whole curve rightward.",
  },
  {
    id: "eco-13",
    subjectSlug: "economics",
    topic: "Demand — Related Goods",
    stem: "Tea and coffee are substitutes. If the price of coffee rises sharply, the demand for tea will:",
    options: ["increase", "decrease", "stay the same", "first rise, then fall to zero"],
    answer: "A",
    explanation:
      "When two goods are substitutes, a price rise for one shifts demand toward the other — consumers switch to the relatively cheaper good.",
  },
  {
    id: "eco-14",
    subjectSlug: "economics",
    topic: "Supply",
    stem: "According to the law of supply, a higher price for teff encourages farmers to offer more for sale because:",
    options: [
      "higher prices raise the profitability of producing and selling teff",
      "consumers demand less at high prices",
      "the government always subsidizes high prices",
      "supply is fixed by nature",
    ],
    answer: "A",
    explanation:
      "Higher prices raise expected profit, so producers expand output — the supply curve slopes upward.",
  },
  {
    id: "eco-15",
    subjectSlug: "economics",
    topic: "Market Equilibrium",
    stem: "A price ceiling (maximum price) set BELOW the equilibrium price causes:",
    options: ["a shortage — quantity demanded exceeds quantity supplied", "a surplus", "equilibrium", "higher quality goods"],
    answer: "A",
    explanation:
      "At a legally enforced price below equilibrium, buyers want more than sellers are willing to supply — the classic shortage (with queues and rationing).",
  },
  {
    id: "eco-16",
    subjectSlug: "economics",
    topic: "Price Elasticity of Demand",
    stem: "When the price of a good rises by 10% and the quantity demanded falls by 20%, the price elasticity of demand is:",
    options: ["2 and demand is elastic", "0.5 and demand is inelastic", "1 and demand is unit elastic", "30 and demand is perfectly elastic"],
    answer: "A",
    explanation:
      "Elasticity = %ΔQ ÷ %ΔP = 20 ÷ 10 = 2. Values greater than 1 mean demand is elastic — typical of goods with close substitutes.",
  },
  {
    id: "eco-17",
    subjectSlug: "economics",
    topic: "Price Elasticity of Demand",
    stem: "Demand for a life-saving medicine is most likely to be:",
    options: ["highly inelastic", "highly elastic", "perfectly elastic", "unit elastic"],
    answer: "A",
    explanation:
      "Necessities with no close substitutes have inelastic demand — patients buy roughly the same quantity even when the price rises.",
  },
  {
    id: "eco-18",
    subjectSlug: "economics",
    topic: "Income Elasticity",
    stem: "If rising incomes cause consumers to buy LESS of a good, that good is classified as:",
    options: ["an inferior good", "a normal good", "a luxury good", "a substitute good"],
    answer: "A",
    explanation:
      "Inferior goods have negative income elasticity — as people become better off they switch to preferred alternatives.",
  },
  {
    id: "eco-19",
    subjectSlug: "economics",
    topic: "Utility",
    stem: "The law of diminishing marginal utility says that as a consumer drinks successive cups of water on a hot day:",
    options: [
      "the extra satisfaction from each additional cup falls",
      "total satisfaction becomes negative immediately",
      "each cup gives identical satisfaction",
      "the price of water must rise",
    ],
    answer: "A",
    explanation:
      "Each additional unit yields less extra utility than the previous one — the foundation of downward-sloping demand curves.",
  },
  {
    id: "eco-20",
    subjectSlug: "economics",
    topic: "Production — Diminishing Returns",
    stem: "The law of diminishing marginal returns applies when:",
    options: [
      "more units of a variable input (e.g., labor) are added to a FIXED input (e.g., land) in the short run",
      "all inputs are increased proportionally in the long run",
      "a firm builds a new factory",
      "technology improves",
    ],
    answer: "A",
    explanation:
      "With land fixed, extra workers eventually add less and less extra output — diminishing returns is a short-run law; returns to scale is the long-run counterpart.",
  },
  {
    id: "eco-21",
    subjectSlug: "economics",
    topic: "Costs of Production",
    stem: "Which cost does NOT change with the level of output in the short run?",
    options: ["fixed cost (e.g., factory rent)", "raw material cost", "electricity for machines", "packaging cost"],
    answer: "A",
    explanation:
      "Fixed costs (rent, salaries of permanent staff) must be paid whatever the output; variable costs rise and fall with production.",
  },
  {
    id: "eco-22",
    subjectSlug: "economics",
    topic: "Profit Maximization",
    stem: "A profit-maximizing firm produces where:",
    options: ["marginal revenue equals marginal cost (MR = MC)", "total revenue is zero", "average cost is at its maximum", "price equals zero"],
    answer: "A",
    explanation:
      "Producing up to MR = MC squeezes out every unit that adds more to revenue than to cost — the profit-maximizing rule in any market structure.",
  },
  {
    id: "eco-23",
    subjectSlug: "economics",
    topic: "Economies of Scale",
    stem: "Economies of scale occur when, in the long run, increasing all inputs causes average cost to:",
    options: ["fall", "rise", "stay constant forever", "become negative"],
    answer: "A",
    explanation:
      "Larger scale can spread fixed costs and allow specialization, lowering cost per unit; beyond a point diseconomies may set in.",
  },
  {
    id: "eco-24",
    subjectSlug: "economics",
    topic: "Market Structures",
    stem: "In perfect competition, an individual firm is a:",
    options: ["price taker — it cannot influence the market price", "price maker", "monopolist", "natural monopoly"],
    answer: "A",
    explanation:
      "With many small sellers of an identical product, each firm's output is too small to move the market price — it takes the price as given.",
  },
  {
    id: "eco-25",
    subjectSlug: "economics",
    topic: "Market Structures",
    stem: "A market dominated by a few large firms whose decisions affect one another is called:",
    options: ["an oligopoly", "perfect competition", "monopolistic competition", "a command market"],
    answer: "A",
    explanation:
      "Oligopoly — few sellers, high barriers, strategic interdependence (e.g., telecom or airline markets).",
  },
  {
    id: "eco-26",
    subjectSlug: "economics",
    topic: "National Income — GDP",
    stem: "Which statement correctly distinguishes GDP from GNP (GNI)?",
    options: [
      "GDP measures production within a country's borders; GNP measures production by the country's nationals wherever they are",
      "GDP counts only exports; GNP counts only imports",
      "GDP excludes services; GNP includes services",
      "There is no difference",
    ],
    answer: "A",
    explanation:
      "GDP is territorial; GNP/GNI is ownership-based, adding net income earned abroad by nationals.",
  },
  {
    id: "eco-27",
    subjectSlug: "economics",
    topic: "National Income — Real vs Nominal",
    stem: "Real GDP differs from nominal GDP because real GDP is measured:",
    options: [
      "at constant (base-year) prices, removing the effect of inflation",
      "in foreign currency",
      "including intermediate goods",
      "only for the government sector",
    ],
    answer: "A",
    explanation:
      "Nominal GDP uses current prices and can rise merely because of inflation; real GDP values output at base-year prices, revealing genuine growth.",
  },
  {
    id: "eco-28",
    subjectSlug: "economics",
    topic: "National Income — Approaches",
    stem: "The expenditure approach to measuring GDP sums:",
    options: [
      "consumption + investment + government spending + net exports",
      "wages + rent + interest + profit",
      "the value of intermediate goods only",
      "taxes minus subsidies",
    ],
    answer: "A",
    explanation:
      "GDP = C + I + G + (X − M): all final spending on domestic output; the income approach instead sums factor incomes.",
  },
  {
    id: "eco-29",
    subjectSlug: "economics",
    topic: "Money — Functions",
    stem: "Which of the following is NOT a function of money?",
    options: ["being a factor of production", "medium of exchange", "unit of account", "store of value"],
    answer: "A",
    explanation:
      "The classic functions of money are medium of exchange, unit of account, store of value and standard of deferred payment — money is not itself a factor of production.",
  },
  {
    id: "eco-30",
    subjectSlug: "economics",
    topic: "Barter and Money",
    stem: "The main problem of a barter economy that money solves is:",
    options: [
      "the double coincidence of wants — both sides must want exactly what the other offers",
      "excessive price stability",
      "too much saving",
      "oversupply of gold",
    ],
    answer: "A",
    explanation:
      "Barter requires each trader to want the other's good at the same time; money as a universally accepted medium removes that constraint.",
  },
  {
    id: "eco-31",
    subjectSlug: "economics",
    topic: "Inflation — Causes",
    stem: "Inflation caused by a surge in aggregate demand beyond the economy's productive capacity is called:",
    options: ["demand-pull inflation", "cost-push inflation", "deflation", "stagflation"],
    answer: "A",
    explanation:
      "Demand-pull inflation is 'too much money chasing too few goods'; cost-push inflation instead originates from rising input costs.",
  },
  {
    id: "eco-32",
    subjectSlug: "economics",
    topic: "Inflation — Measurement",
    stem: "The most common instrument for measuring the rate of inflation is the:",
    options: [
      "Consumer Price Index (CPI)",
      "exchange rate of the birr",
      "unemployment rate",
      "balance of payments",
    ],
    answer: "A",
    explanation:
      "The CPI tracks the cost of a fixed basket of consumer goods and services; its percentage change is the headline inflation rate.",
  },
  {
    id: "eco-33",
    subjectSlug: "economics",
    topic: "Inflation — Effects",
    stem: "Who is most likely to LOSE from unexpected inflation?",
    options: ["creditors who lent money at fixed interest", "borrowers repaying fixed debts", "holders of real assets", "none of these"],
    answer: "A",
    explanation:
      "Unexpected inflation erodes the real value of money repayments, hurting lenders (creditors) while easing the burden on borrowers.",
  },
  {
    id: "eco-34",
    subjectSlug: "economics",
    topic: "Banking — Central Bank",
    stem: "In Ethiopia, the central bank responsible for issuing currency and conducting monetary policy is the:",
    options: ["National Bank of Ethiopia (NBE)", "Commercial Bank of Ethiopia", "Development Bank of Ethiopia", "Ministry of Trade"],
    answer: "A",
    explanation:
      "The NBE issues the birr, regulates banks, holds foreign reserves and acts as lender of last resort — the standard central-bank functions.",
  },
  {
    id: "eco-35",
    subjectSlug: "economics",
    topic: "Banking — Commercial Banks",
    stem: "Commercial banks 'create money' mainly by:",
    options: [
      "making loans that become new deposits in the banking system",
      "printing paper currency",
      "collecting taxes",
      "minting coins",
    ],
    answer: "A",
    explanation:
      "Only the central bank issues currency; commercial banks expand the money supply through credit creation, constrained by reserve requirements.",
  },
  {
    id: "eco-36",
    subjectSlug: "economics",
    topic: "Monetary Policy",
    stem: "Which of the following is a tool of MONETARY policy?",
    options: [
      "changing the minimum reserve requirement for banks",
      "changing income tax rates",
      "approaching the annual government budget",
      "nationalizing a factory",
    ],
    answer: "A",
    explanation:
      "Monetary policy tools are open-market operations, the reserve ratio, the discount/re-discount rate and related bank-regulation levers; taxes and budgets are fiscal policy.",
  },
  {
    id: "eco-37",
    subjectSlug: "economics",
    topic: "Fiscal Policy and Taxation",
    stem: "Value Added Tax (VAT), introduced in Ethiopia in 2003, is an example of a(n):",
    options: ["indirect tax", "direct tax", "progressive income tax", "property tax"],
    answer: "A",
    explanation:
      "VAT is collected on spending on goods and services (an indirect tax); direct taxes such as income tax are levied directly on persons and firms.",
  },
  {
    id: "eco-38",
    subjectSlug: "economics",
    topic: "Taxation Systems",
    stem: "A tax system in which the tax rate RISES as income rises is called:",
    options: ["progressive", "regressive", "proportional", "lump-sum"],
    answer: "A",
    explanation:
      "Progressive taxation takes a larger share of higher incomes; regressive taxation takes a larger share of low incomes; proportional takes a constant fraction.",
  },
  {
    id: "eco-39",
    subjectSlug: "economics",
    topic: "International Trade — Comparative Advantage",
    stem: "David Ricardo's principle of comparative advantage shows that trade is beneficial when each country specializes in goods it produces at:",
    options: [
      "the lowest relative (opportunity) cost, even if another country is better at everything",
      "the lowest absolute cost only",
      "the highest cost",
      "identical cost to its partner",
    ],
    answer: "A",
    explanation:
      "Comparative advantage is about relative opportunity cost: total output rises when each country specializes where its opportunity cost is lowest.",
  },
  {
    id: "eco-40",
    subjectSlug: "economics",
    topic: "Balance of Payments",
    stem: "If a country's exports of goods are worth 500 billion birr and its imports are worth 650 billion birr, its balance of TRADE is:",
    options: ["a deficit of 150 billion birr", "a surplus of 150 billion birr", "balanced", "a surplus of 1,150 billion birr"],
    answer: "A",
    explanation:
      "Trade balance = exports − imports = 500 − 650 = −150 billion birr, a trade deficit (one component of the wider balance of payments).",
  },
  {
    id: "eco-41",
    subjectSlug: "economics",
    topic: "Exchange Rates",
    stem: "A DEPRECIATION of the Ethiopian birr against the US dollar will most likely:",
    options: [
      "make Ethiopian coffee exports cheaper in dollars and imports more expensive in birr",
      "make exports more expensive and imports cheaper",
      "have no effect on trade",
      "force the National Bank to print more currency",
    ],
    answer: "A",
    explanation:
      "A weaker birr lowers the foreign-currency price of exports (boosting them) and raises the birr price of imports.",
  },
  {
    id: "eco-42",
    subjectSlug: "economics",
    topic: "Trade Protection",
    stem: "A tax imposed on imported goods to protect domestic producers is called a(n):",
    options: ["tariff", "quota", "subsidy", "embargo"],
    answer: "A",
    explanation:
      "Tariffs raise import prices; quotas limit quantities directly; embargoes ban trade entirely; subsidies support producers rather than tax imports.",
  },
  {
    id: "eco-43",
    subjectSlug: "economics",
    topic: "Growth vs Development",
    stem: "Economic development differs from economic growth because development also includes:",
    options: [
      "improvements in health, education, income distribution and living standards",
      "only the increase in real GDP",
      "only the growth of the money supply",
      "only military strength",
    ],
    answer: "A",
    explanation:
      "Growth is a quantitative rise in output; development is broader — structural change and welfare gains, often measured by the Human Development Index.",
  },
  {
    id: "eco-44",
    subjectSlug: "economics",
    topic: "Human Development Index",
    stem: "The Human Development Index (HDI) combines three dimensions of wellbeing. They are:",
    options: [
      "life expectancy (health), schooling (education) and income per capita (standard of living)",
      "inflation, unemployment and exports",
      "land area, population and army size",
      "gold reserves, oil and gas",
    ],
    answer: "A",
    explanation:
      "The UN's HDI averages a long and healthy life, knowledge (years of schooling) and a decent standard of living (GNI per capita).",
  },
  {
    id: "eco-45",
    subjectSlug: "economics",
    topic: "The Ethiopian Economy",
    stem: "Under the FDRE Constitution, rural land in Ethiopia is:",
    options: [
      "owned by the state and the peoples of Ethiopia and not subject to sale",
      "privately owned and freely sold to foreigners",
      "owned by the National Bank",
      "owned by foreign investors",
    ],
    answer: "A",
    explanation:
      "Article 40 of the FDRE Constitution vests ownership of rural and urban land in the state and the peoples, with farmers granted use rights ('user holding').",
  },

  // ── SCHOLASTIC APTITUDE (12: 5 original + 7 verified expansion) ─────
  {
    id: "sat-01",
    subjectSlug: "scholastic-aptitude-test",
    topic: "Number Series",
    stem: "Find the next term in the series: 2, 6, 12, 20, 30, ____.",
    options: ["36", "40", "42", "46"],
    answer: "C",
    explanation:
      "Differences grow 4, 6, 8, 10 — the next difference is 12, so 30 + 12 = 42. (The pattern is n(n+1): 1·2, 2·3, 3·4, …, 6·7.)",
  },
  {
    id: "sat-02",
    subjectSlug: "scholastic-aptitude-test",
    topic: "Odd One Out",
    stem: "Which number does not belong: 3, 5, 7, 9, 11?",
    options: ["3", "5", "9", "11"],
    answer: "C",
    explanation: "3, 5, 7 and 11 are prime; 9 = 3 × 3 is composite, so it is the odd one out.",
  },
  {
    id: "sat-03",
    subjectSlug: "scholastic-aptitude-test",
    topic: "Logical Deduction",
    stem: "Every member of the science club speaks Amharic. Sara is a member of the science club. Therefore:",
    options: [
      "Sara speaks Amharic.",
      "Sara does not speak Amharic.",
      "Only club members speak Amharic.",
      "Everyone who speaks Amharic is in the club.",
    ],
    answer: "A",
    explanation:
      "This is a valid syllogism: if all members speak Amharic and Sara is a member, Sara must speak Amharic. The other options reverse or over-extend the rule.",
  },
  {
    id: "sat-04",
    subjectSlug: "scholastic-aptitude-test",
    topic: "Analogies",
    stem: "Complete the analogy: Bird is to nest as bee is to ____.",
    options: ["flower", "hive", "honey", "wax"],
    answer: "B",
    explanation: "The relationship is “animal → its home”: a bird lives in a nest, a bee lives in a hive.",
  },
  {
    id: "sat-05",
    subjectSlug: "scholastic-aptitude-test",
    topic: "Quantitative Reasoning",
    stem: "Three students share 360 birr in the ratio 1 : 2 : 3. How much does the largest share receive?",
    options: ["60 birr", "120 birr", "180 birr", "240 birr"],
    answer: "C",
    explanation: "The parts total 1 + 2 + 3 = 6. One part = 360 ÷ 6 = 60, so the largest share = 3 × 60 = 180 birr.",
  },

  // ── SCHOLASTIC APTITUDE EXPANSION (sat-06 … sat-12) — verbal, logical and
  //    quantitative reasoning. Human-authored for Learnyx with computed or
  //    uniquely-derivable answers. Appended AFTER sat-05 so the
  //    (contentId, questionNumber) upsert mapping stays stable.
  {
    id: "sat-06",
    subjectSlug: "scholastic-aptitude-test",
    topic: "Verbal Analogies",
    stem: "DOCTOR is to HOSPITAL as TEACHER is to ______.",
    options: ["school", "hospital", "engine", "keyboard"],
    answer: "A",
    explanation: "A doctor works in a hospital as a teacher works in a school — a worker-to-workplace analogy.",
  },
  {
    id: "sat-07",
    subjectSlug: "scholastic-aptitude-test",
    topic: "Number Series",
    stem: "Find the next number in the series: 2, 6, 12, 20, 30, ____.",
    options: ["42", "40", "36", "45"],
    answer: "A",
    explanation:
      "The gaps grow 4, 6, 8, 10 — the next gap is 12, so 30 + 12 = 42 (the pattern is n × (n + 1): 1×2, 2×3, 3×4 … 6×7 = 42).",
  },
  {
    id: "sat-08",
    subjectSlug: "scholastic-aptitude-test",
    topic: "Coding and Decoding",
    stem: "If CAT is coded as DBU, then DOG is coded as:",
    options: ["EPH", "EPI", "DPH", "FQI"],
    answer: "A",
    explanation:
      "Each letter shifts forward by one (C→D, A→B, T→U); applying the same shift, D→E, O→P, G→H gives EPH.",
  },
  {
    id: "sat-09",
    subjectSlug: "scholastic-aptitude-test",
    topic: "Direction Sense",
    stem: "A student walks 3 km north, then 4 km east. How far is the student from the starting point (straight-line distance)?",
    options: ["5 km", "7 km", "1 km", "12 km"],
    answer: "A",
    explanation:
      "North then east forms a right angle, so the straight-line distance is the hypotenuse: √(3² + 4²) = √25 = 5 km.",
  },
  {
    id: "sat-10",
    subjectSlug: "scholastic-aptitude-test",
    topic: "Logical Deduction",
    stem: "A closed box contains exactly ONE type of fruit: apples, mangoes, or bananas. It is not apples and it is not mangoes. Which fruit does the box contain?",
    options: ["bananas", "apples", "mangoes", "it cannot be determined"],
    answer: "A",
    explanation:
      "Exactly one of the three fruits is in the box; ruling out apples and mangoes leaves bananas — a simple process-of-elimination deduction.",
  },
  {
    id: "sat-11",
    subjectSlug: "scholastic-aptitude-test",
    topic: "Percentage Problems",
    stem: "The price of a book rises from 400 birr to 460 birr. What is the percentage increase?",
    options: ["15%", "16%", "12%", "20%"],
    answer: "A",
    explanation: "Increase = 60 birr on a 400 birr base: (60 ÷ 400) × 100 = 15%.",
  },
  {
    id: "sat-12",
    subjectSlug: "scholastic-aptitude-test",
    topic: "Speed, Distance and Time",
    stem: "A bus travels at a constant 60 km/h. How far does it travel in 2 hours and 30 minutes?",
    options: ["150 km", "120 km", "180 km", "90 km"],
    answer: "A",
    explanation: "2.5 hours × 60 km/h = 150 km.",
  },
];
