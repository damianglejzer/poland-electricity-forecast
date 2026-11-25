/** Site-wide settings. Override with VITE_* variables at build time (e.g. in Vercel). */
export const SITE = {
  name: "GridCast",
  author: import.meta.env.VITE_AUTHOR_NAME || "Damian Glejzer",
  githubUrl: import.meta.env.VITE_GITHUB_URL || "",
  linkedinUrl: import.meta.env.VITE_LINKEDIN_URL || "",
};
