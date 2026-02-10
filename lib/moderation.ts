import { Filter } from "bad-words";

const filter = new Filter();

export function checkProfanity(text: string): { hasProfanity: boolean; message: string } {
  if (filter.isProfane(text)) {
    return { hasProfanity: true, message: "Please keep strategy names professional" };
  }
  return { hasProfanity: false, message: "" };
}

export function checkSpam(text: string): { isSpam: boolean; message: string } {
  // Check for excessive caps (more than 70% uppercase in a string of 5+ chars)
  if (text.length >= 5) {
    const upperCount = (text.match(/[A-Z]/g) || []).length;
    const letterCount = (text.match(/[a-zA-Z]/g) || []).length;
    if (letterCount > 0 && upperCount / letterCount > 0.7) {
      return { isSpam: true, message: "Please avoid excessive capitalization" };
    }
  }

  // Check for repeated characters (4+ of the same char in a row)
  if (/(.)\1{3,}/.test(text)) {
    return { isSpam: true, message: "Please avoid repeated characters" };
  }

  return { isSpam: false, message: "" };
}

export function moderateText(text: string): { ok: boolean; error: string } {
  const profanityCheck = checkProfanity(text);
  if (profanityCheck.hasProfanity) {
    return { ok: false, error: profanityCheck.message };
  }

  const spamCheck = checkSpam(text);
  if (spamCheck.isSpam) {
    return { ok: false, error: spamCheck.message };
  }

  return { ok: true, error: "" };
}
