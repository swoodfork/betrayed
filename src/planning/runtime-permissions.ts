const runtimeEveryonePermissions = new Set(["UseSoundboard"]);

export function permissionsForStructuralComparison(
  permissions: string[],
  isEveryoneRole: boolean,
): string[] {
  return isEveryoneRole
    ? permissions.filter(
        (permission) => !runtimeEveryonePermissions.has(permission),
      )
    : [...permissions];
}

export function preserveRuntimeEveryonePermissions(
  desiredAllow: string[],
  desiredDeny: string[],
  currentAllow: string[],
  currentDeny: string[],
  isEveryoneRole: boolean,
): { allow: string[]; deny: string[] } {
  if (!isEveryoneRole) {
    return { allow: [...desiredAllow], deny: [...desiredDeny] };
  }

  return {
    allow: [...new Set([
      ...desiredAllow,
      ...currentAllow.filter((permission) =>
        runtimeEveryonePermissions.has(permission),
      ),
    ])],
    deny: [...new Set([
      ...desiredDeny,
      ...currentDeny.filter((permission) =>
        runtimeEveryonePermissions.has(permission),
      ),
    ])],
  };
}
