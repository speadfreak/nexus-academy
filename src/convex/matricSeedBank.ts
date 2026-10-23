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

  // ── HISTORY (5) ─────────────────────────────────────────────────────
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

  // ── GEOGRAPHY (5) ───────────────────────────────────────────────────
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

  // ── ECONOMICS (5) ───────────────────────────────────────────────────
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

  // ── SCHOLASTIC APTITUDE (5) ─────────────────────────────────────────
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
];
