/** Evaluación de logros: una vez por cuenta, idempotente y sin perderse aunque se vendan muebles. */

import { ACHIEVEMENTS, type AchievementDef } from "../data/achievements";
import { findItem, shopGroup, type Tag } from "../data/catalog";
import { roomsForLevel } from "../data/levels";
import { communityMissionsEnabled } from "../data/missions";
import { NEIGHBORS } from "../data/neighbors";
import { itemLookup, placedInRoom, roomAccessible } from "./layout";
import type { GameState } from "./types";

function placedRooms(state: GameState) {
  return roomsForLevel(state.level, state.expansions).map((r) => ({ room: r, list: placedInRoom(state.placements, r.id) }));
}

export function achievementMet(state: GameState, def: AchievementDef, communityDone: number): boolean {
  const rule = def.rule;
  const itemOf = itemLookup(state);
  const rooms = placedRooms(state);
  const roomHas = (list: (typeof rooms)[number]["list"], tag: Tag) => list.some((p) => itemOf(p.uid)?.tags.includes(tag));
  switch (rule.type) {
    case "reports": return state.validReportCount >= rule.n;
    case "streak": return state.streak.best >= rule.n;
    case "perfectWeek": return state.streak.perfectWeeks.length > 0;
    case "protectorEarned": return state.streak.protectorsEarned > 0;
    case "placedInstances": {
      const owned = new Set(state.inventory.filter((o) => !o.soldAt).map((o) => o.uid));
      return state.placedEver.filter((uid) => owned.has(uid)).length >= rule.n;
    }
    case "placedCategories":
      return new Set(state.placedEver.map((uid) => itemOf(uid)).filter((i) => i).map((i) => shopGroup(i!))).size >= rule.n;
    case "roomComplete":
      return rooms.some(({ room, list }) => list.length >= rule.n && roomAccessible(room, state.placements, itemOf));
    case "roomsWith": return rooms.filter(({ list }) => list.length >= rule.n).length >= rule.rooms;
    case "floorsWith": {
      const perFloor = [0, 1].map((f) => rooms.filter(({ room }) => room.floor === f).reduce((n, r) => n + r.list.length, 0));
      return perFloor.every((n) => n >= rule.n);
    }
    case "ownRarity": {
      const ids = new Set(state.inventory.filter((o) => !o.soldAt && o.source === "purchase").map((o) => o.itemId));
      return [...ids].filter((id) => findItem(id)?.rarity === rule.rarity).length >= rule.n;
    }
    case "showcase": return state.showcase.length >= rule.n;
    case "realLibraries": return new Set(state.realViews.map((v) => v.libraryId)).size >= rule.n;
    case "virtualVisits": return new Set(state.virtualVisits.map((v) => v.ownerId)).size >= rule.n;
    case "communityMissions": return communityDone >= rule.n;
    case "catNap": return state.catNapSeen;
    case "vinylCorner": return rooms.some(({ list }) => roomHas(list, "record") && roomHas(list, "vinyl"));
    case "quietHour":
      return rooms.some(({ list }) => roomHas(list, "armchair") && roomHas(list, "shelf") && roomHas(list, "lamp") && roomHas(list, "plant"));
    case "astral":
      return new Set(state.placements.map((p) => itemOf(p.uid)).filter((i) => i?.tags.includes("astral")).map((i) => i!.id)).size >= rule.n;
    case "smallExhibition":
      return state.showcase.length >= 3 && state.placements.some((p) => {
        const item = itemOf(p.uid);
        return item?.tags.includes("culture") && item.kind === "vitrine";
      });
  }
}

/**
 * Logros que todavía no se pueden conseguir: los comunitarios sin misiones comunitarias y los de
 * visitas que piden más bibliotecas distintas de las que hay. Se enseñan como «Próximamente».
 */
export function achievementAvailable(def: AchievementDef): boolean {
  if (def.rule.type === "communityMissions") return communityMissionsEnabled();
  if (def.rule.type === "virtualVisits") return NEIGHBORS.length >= def.rule.n;
  return true;
}

export function pendingAchievements(state: GameState, communityDone: number): AchievementDef[] {
  return ACHIEVEMENTS.filter((def) => !state.achievements[def.id] && achievementMet(state, def, communityDone));
}
