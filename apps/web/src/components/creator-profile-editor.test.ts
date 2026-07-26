import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./creator-profile-editor.tsx", import.meta.url),
  "utf8",
);

describe("CreatorProfileEditor avatar flow", () => {
  it("uses the avatar tile as the file picker without a second apply button", () => {
    expect(source).toContain('className="profile-avatar-upload"');
    expect(source).toContain('className="profile-avatar-add-icon"');
    expect(source).toContain('className="sr-only"');
    expect(source).toContain('type="file"');
    expect(source).not.toContain("Use avatar");
  });

  it("uploads a selected avatar as part of saving the profile", () => {
    const uploadPosition = source.indexOf("await uploadAvatar()");
    const savePosition = source.indexOf("JSON.stringify(profileToSave)");

    expect(uploadPosition).toBeGreaterThan(0);
    expect(savePosition).toBeGreaterThan(uploadPosition);
  });
});
