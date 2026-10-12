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
  /**
   * Abilities the boss aims at chosen players (a mark, a tether, a bolt someone failed to interrupt), by
   * log name. Moving doesn't avoid them, so they're never "avoidable". Only list what the data can't see on
   * its own: abilities that hit the same number of players every kill are detected automatically.
   */
  targeted?: string[];
}
