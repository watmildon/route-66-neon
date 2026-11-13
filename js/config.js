// Optional Mapillary *client* token (starts with "MLY|").
//
// With a token, Mapillary photos load as a plain image via the Graph API.
// Without one, the page falls back to Mapillary's embeddable viewer, which
// works but is heavier. Client tokens are designed to ship in browser code
// (iD and Rapid publish theirs); create one at
// https://www.mapillary.com/dashboard/developers — a tiles-only key will not
// work here because it can't read image metadata.
export const MAPILLARY_CLIENT_TOKEN = "";
