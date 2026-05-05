export type Racer = {
  login: string;
  avatarUrl: string;
  htmlUrl: string;
  additions: number;
  deletions: number;
  commits: number;
};

export type RepoRace = {
  name: string;
  fullName: string;
  htmlUrl: string;
  private: boolean;
  totalAdditions: number;
  totalDeletions: number;
  totalCommits: number;
  racers: Racer[];
};

export type RaceData = {
  org: string;
  since: string;
  until: string;
  totalAdditions: number;
  totalDeletions: number;
  totalCommits: number;
  racers: Racer[];
  repos: RepoRace[];
  warnings: string[];
  generatedAt: string;
};
