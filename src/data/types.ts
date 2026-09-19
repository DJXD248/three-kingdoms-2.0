
export interface GeneralData {
  id: string;
  name: string;
  faction: string;
  hp: number;
  skills: string[];
}

export interface CardData {
  id: string;
  name: string;
  type: string;
  description: string;
}

export interface SkillDataReference {
  id: string;
}
