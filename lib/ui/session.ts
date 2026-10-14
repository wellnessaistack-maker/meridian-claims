// The signed-in adjuster. A mock identity for the prototype, as the earlier
// prototype had: in production this comes from Meridian's SSO and the
// reviewer field of the audit record is filled from it, never typed.

export const ADJUSTER = { id: "ADJ-110", name: "Jordan Reyes", initials: "JR" } as const;

/** The reviewer string written to the audit record. */
export const reviewerLabel = (role: string) => `${ADJUSTER.name} (${ADJUSTER.id}, ${role})`;
