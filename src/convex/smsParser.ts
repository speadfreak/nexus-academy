// TeleBirr SMS parser — pure function, no Convex dependencies.
//
// Extracted to its own file so http.ts can import it without pulling in
// the Convex action/mutation exports from manualPayments.ts (which
// causes the HTTP route to fail to register on the Convex deployment).

export interface ParsedTeleBirrSms {
  accountHolder: string;
  senderName: string;
  maskedPhone: string;
  amount: number;
  date: string;
  time: string;
  transactionRef: string;
  balance: string;
  dateImplausible: boolean;
}

export function parseTeleBirrSms(smsText: string): ParsedTeleBirrSms | null {
  const text = smsText.trim();

  const REQUIRED_PHRASES = [
    "ተቀብለዋል፡፡",
    "የሂሳብ እንቅስቃሴ ቁጥርዎ",
    "ቀሪ ሂሳብ",
    "በቴሌብር ስለተገለገሉ",
    "ኢትዮ ቴሌኮም",
  ];
  for (const phrase of REQUIRED_PHRASES) {
    if (!text.includes(phrase)) return null;
  }

  const lines = text.split("\n").map((l) => l.trim());
  let accountHolder = "";
  for (const line of lines) {
    if (line.startsWith("ውድ ")) {
      accountHolder = line.slice("ውድ ".length).trim();
      break;
    }
  }
  if (!accountHolder) return null;

  const line2Regex =
    /ከ\s+(.+?)\((.+?)\)\s+([\d,]+\.\d{2})\s+ብር\s+በ\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/;

  let senderName = "";
  let maskedPhone = "";
  let amountStr = "";
  let date = "";
  let time = "";
  let matchedLine2 = false;

  for (const line of lines) {
    const m = line.match(line2Regex);
    if (m) {
      senderName = m[1].trim();
      maskedPhone = `(${m[2]})`;
      amountStr = m[3];
      date = m[4];
      time = m[5];
      matchedLine2 = true;
      break;
    }
  }
  if (!matchedLine2) return null;

  const amount = parseFloat(amountStr.replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;

  const txRefRegex = /ቁጥርዎ\s+([A-Za-z0-9]+)\s+ነዉ/;
  let transactionRef = "";
  let matchedTxRef = false;
  for (const line of lines) {
    const m = line.match(txRefRegex);
    if (m) {
      transactionRef = m[1];
      matchedTxRef = true;
      break;
    }
  }
  if (!matchedTxRef || !transactionRef) return null;

  const balanceRegex = /ቀሪ ሂሳብ\s+([\d,]+\.\d{2})\s+ብር/;
  let balance = "";
  for (const line of lines) {
    const m = line.match(balanceRegex);
    if (m) {
      balance = m[1];
      break;
    }
  }

  const dateParts = date.split("/");
  const monthPart = parseInt(dateParts[1] ?? "0", 10);
  const dateImplausible = monthPart > 12;

  return {
    accountHolder,
    senderName,
    maskedPhone,
    amount,
    date,
    time,
    transactionRef,
    balance,
    dateImplausible,
  };
}
