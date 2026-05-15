/**
 * Path → ActiveEntity heuristic.
 *
 * The file tree is generic (it shows whatever's on disk), but the
 * EntityEditor and the agent's per-entity prompt blocks both want to
 * know whether a given file is "the brief", "a character", etc., so
 * they can light up the right icon, kicker, and template.
 *
 * This is the single source of truth for the canonical-schema
 * recognition. Anything that doesn't match falls through to the
 * generic `"file"` kind — the EntityEditor still opens it, just with
 * a plain "FILE" kicker and no schema-specific affordances.
 */

import type { ActiveEntity } from "./atoms"

export function activeEntityFromPath(
  path: string,
  label: string,
): NonNullable<ActiveEntity> {
  // Top-level singletons.
  if (path === "brief.md") {
    return { kind: "brief", path }
  }
  if (path === "world.md") {
    return { kind: "world", path }
  }
  if (path === "main-script.fountain" || path === "screenplay.fountain") {
    return { kind: "main-script", path }
  }

  if (
    path.endsWith("/shotlist/shotlist.backlot.json") ||
    path === "shotlist.backlot.json" ||
    path.endsWith(".shotlist.json")
  ) {
    return {
      kind: "shotlist",
      label,
      path,
    }
  }

  // Characters: characters/<id>.md (no nested folders, no README).
  const characterMatch = /^characters\/([^/]+)\.md$/.exec(path)
  if (characterMatch && characterMatch[1] !== "README") {
    return {
      kind: "character",
      id: characterMatch[1]!,
      label,
      path,
    }
  }

  // Locations: locations/<id>.md.
  const locationMatch = /^locations\/([^/]+)\.md$/.exec(path)
  if (locationMatch && locationMatch[1] !== "README") {
    return {
      kind: "location",
      id: locationMatch[1]!,
      label,
      path,
    }
  }

  // Act notes: acts/<actId>/act.md.
  const actMatch = /^acts\/([^/]+)\/act\.md$/.exec(path)
  if (actMatch) {
    return {
      kind: "act",
      id: actMatch[1]!,
      label,
      path,
    }
  }

  // Scenes inside acts: acts/<actId>/scenes/<sceneId>/scene.fountain.
  const actScene = /^acts\/([^/]+)\/scenes\/([^/]+)\/scene\.fountain$/.exec(path)
  if (actScene) {
    return {
      kind: "scene",
      id: actScene[2]!,
      label,
      actId: actScene[1]!,
      path,
    }
  }

  // Flat scenes: scenes/<sceneId>/scene.fountain.
  const flatScene = /^scenes\/([^/]+)\/scene\.fountain$/.exec(path)
  if (flatScene) {
    return {
      kind: "scene",
      id: flatScene[1]!,
      label,
      actId: null,
      path,
    }
  }

  // Shots: scenes/<sceneId>/shots/<shotId>.md (or under acts/...).
  const shotInAct =
    /^acts\/[^/]+\/scenes\/([^/]+)\/shots\/([^/]+)\.md$/.exec(path)
  const shotFlat = /^scenes\/([^/]+)\/shots\/([^/]+)\.md$/.exec(path)
  const shotMatch = shotInAct ?? shotFlat
  if (shotMatch) {
    return {
      kind: "shot",
      sceneId: shotMatch[1]!,
      id: shotMatch[2]!,
      label,
      path,
    }
  }

  // Fall through — generic file. EntityEditor still opens it.
  return {
    kind: "file",
    label,
    path,
  }
}

/**
 * Strip a file extension to produce a label. ".md" / ".fountain" /
 * ".txt" are common; for anything else, the full filename remains
 * (so "Dockerfile" stays "Dockerfile").
 */
export function labelFromFilename(name: string): string {
  const m = /^(.+)\.(md|fountain|txt|json|yaml|yml)$/i.exec(name)
  return m ? m[1]! : name
}
