export interface AbilityTip {
  tip: string;
  /** Who the tip is for, when it's role-specific. */
  role?: "tank" | "healer";
}

export interface Boss {
  encounterId: number;
  name: string;
  /** Full strategy guide. */
  guideUrl?: string;
  /** Ability name as it appears in logs → tip. */
  tips: Record<string, AbilityTip>;
}
