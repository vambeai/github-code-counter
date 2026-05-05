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

export type Warning = {
  repo: string;
  reason: string;
  message: string;
  attempts: number;
  lastStatus: number | null;
  rateLimit?: {
    limit?: string;
    remaining?: string;
    reset?: string;
    used?: string;
    resource?: string;
  };
  responseHeaders?: Record<string, string>;
  rawBody?: string;
  requestId?: string;
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
  warnings: Warning[];
  generatedAt: string;
};
