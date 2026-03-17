export interface JobExtraction {
  jobTitle: string;
  company: string;
  jobDescription: string;
  salary: string | null;
  easyApply: boolean;
  jobAge: string | null;
  jobAgeIsOld: boolean;
  jobId: string;
  url: string;
}

export interface ExtractionResult {
  success: boolean;
  data?: JobExtraction;
  reason?: string;
}
