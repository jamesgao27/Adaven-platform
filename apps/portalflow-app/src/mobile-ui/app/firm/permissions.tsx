import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../shared-logic/supabase';
import { getCurrentSpace } from '../../../shared-logic/auth';
import { getFirmSpaceMembers, type FirmSpaceMember } from '../../../shared-logic/firm';
import { showToast } from '../../../shared-logic/toast';
import { GradientText } from '../../../shared-logic/GradientText';
import { confirmDestructive } from '../../../shared-logic/alertWeb';

type PermissionRole = {
  id: string;
  roleName: string;
  roleKey: string;
  isSystem: boolean;
};

type Dimension = 'season' | 'country' | 'scenario' | 'custom';
type ScopeMode = 'all' | 'include';

type OrderLabelRow = { id: string; label_name: string };

const DIMENSIONS: Dimension[] = ['season', 'country', 'scenario', 'custom'];

const DIMENSION_LABEL: Record<Dimension, string> = {
  season: 'Tax season',
  country: 'Jurisdiction',
  scenario: 'Tax scenario',
  custom: 'Custom label',
};

/** Min width ≈ 5 Latin letters at chip label fontSize 12; longer text grows naturally */
const TAG_MIN_LETTER_WIDTH_PX = 7;
const TAG_MIN_LETTERS = 5;
const TAG_MIN_TEXT_WIDTH = TAG_MIN_LETTER_WIDTH_PX * TAG_MIN_LETTERS;
const SCOPE_CHIP_PADDING_H = 10 * 2;
const SCOPE_TAG_MIN_OUTER_WIDTH = SCOPE_CHIP_PADDING_H + TAG_MIN_TEXT_WIDTH;
/** Asymmetric: tighter space to the right of the remove icon */
const MEMBER_PILL_PADDING_LEFT = 12;
const MEMBER_PILL_PADDING_RIGHT = 4;
const MEMBER_TAG_REMOVE_SIZE = 16;
const MEMBER_TAG_GAP = 8;
const MEMBER_TAG_MIN_OUTER_WIDTH =
  MEMBER_PILL_PADDING_LEFT +
  MEMBER_PILL_PADDING_RIGHT +
  MEMBER_TAG_GAP +
  MEMBER_TAG_REMOVE_SIZE +
  TAG_MIN_TEXT_WIDTH;

/** Match pill row height: paddingVertical 5 + line/icon 16 + paddingVertical 5 */
const MEMBER_TAG_PILL_MIN_HEIGHT = 5 + 16 + 5;

/** Read + edit member name chips (fixed; not hash-colored). */
const MEMBER_TAG_BLUE_BG = '#E3F2FD';
const MEMBER_TAG_BLUE_FG = '#1E88E5';

/** ALL chip lit state: read cards + editor (same green). */
const SCOPE_ALL_LIT_BG = '#E8F5E9';
const SCOPE_ALL_LIT_FG = '#2ECC71';
const SCOPE_CHIP_UNLIT_BG = '#F1F3F5';
const SCOPE_CHIP_MUTED_FG = '#95A5A6';

/**
 * Permission scope / classification chips only: stable pseudo-random color from label text or id.
 * Palette excludes member blue so people vs classification tags never share the same scheme.
 */
const SCOPE_LABEL_PALETTE: [string, string][] = [
  ['#E8F5E9', '#2ECC71'],
  ['#FFF3E0', '#E67E22'],
  ['#FCE4EC', '#E91E63'],
  ['#E0F7FA', '#00ACC1'],
  ['#FFF8E1', '#F9A825'],
  ['#F3E5F5', '#9C27B0'],
];

function getScopeLabelColor(key: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) & 0xffff;
  return SCOPE_LABEL_PALETTE[hash % SCOPE_LABEL_PALETTE.length];
}

function emptyLabelsByDim(): Record<Dimension, string[]> {
  return { season: [], country: [], scenario: [], custom: [] };
}

function emptyScopeModeByDim(): Record<Dimension, ScopeMode> {
  return { season: 'all', country: 'all', scenario: 'all', custom: 'all' };
}

function buildDraftDimLabelsFromScope(
  scopeRows: { dimension: string; scope_mode: string; label_ids: unknown }[],
  labelsByDim: Record<Dimension, OrderLabelRow[]>
): Record<Dimension, string[]> {
  const out = emptyLabelsByDim();
  for (const d of DIMENSIONS) {
    const allIds = labelsByDim[d].map((l) => l.id);
    const row = scopeRows.find((s) => s.dimension === d);
    if (allIds.length === 0) {
      out[d] = [];
      continue;
    }
    if (!row || row.scope_mode === 'all') {
      out[d] = [...allIds];
      continue;
    }
    const inc = Array.isArray(row.label_ids) ? (row.label_ids as string[]) : [];
    out[d] = allIds.filter((id) => inc.includes(id));
  }
  return out;
}

function buildDraftDimScopeModeFromScope(
  scopeRows: { dimension: string; scope_mode: string; label_ids: unknown }[]
): Record<Dimension, ScopeMode> {
  const out = emptyScopeModeByDim();
  for (const d of DIMENSIONS) {
    const row = scopeRows.find((s) => s.dimension === d);
    out[d] = row?.scope_mode === 'include' ? 'include' : 'all';
  }
  return out;
}

/**
 * Collapsed card scope line: show ALL only when every dimension is scope_mode `all` (or row missing).
 * If any dimension is `include`, show only the selected label names for those dimensions (no ALL chip).
 */
function buildReadScopeTagsForRole(
  scopeRowsForRole: { dimension: string; scope_mode: string; label_ids: unknown }[],
  labelNameById: Record<string, string>
): string[] {
  const perDim = DIMENSIONS.map((d) => {
    const row = scopeRowsForRole.find((s) => s.dimension === d);
    const mode = row?.scope_mode === 'include' ? 'include' : 'all';
    const ids = Array.isArray(row?.label_ids) ? (row!.label_ids as string[]) : [];
    return { mode, ids };
  });
  if (perDim.every((x) => x.mode === 'all')) return ['ALL'];
  const tags: string[] = [];
  for (const { mode, ids } of perDim) {
    if (mode !== 'include') continue;
    const names = ids.map((id) => labelNameById[id] || id).filter((n) => n != null && String(n).length > 0);
    if (names.length > 0) tags.push(...names);
  }
  return Array.from(new Set(tags));
}

export default function FirmPermissionsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [firmSpaceId, setFirmSpaceId] = useState<string | null>(null);
  const [isFirmSpace, setIsFirmSpace] = useState(true);
  /** Firm space `user_spaces.is_admin` — only admins may add/edit/delete permission roles */
  const [canManagePermissionRoles, setCanManagePermissionRoles] = useState(false);
  const [roles, setRoles] = useState<PermissionRole[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [members, setMembers] = useState<FirmSpaceMember[]>([]);
  const [roleMemberNamesByRoleId, setRoleMemberNamesByRoleId] = useState<Record<string, string[]>>({});
  const [roleScopeTagsByRoleId, setRoleScopeTagsByRoleId] = useState<Record<string, string[]>>({});

  const [orderLabelsByDim, setOrderLabelsByDim] = useState<Record<Dimension, OrderLabelRow[]>>({
    season: [],
    country: [],
    scenario: [],
    custom: [],
  });

  /** null = not editing, 'new' = creating, uuid = editing */
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editRoleName, setEditRoleName] = useState('');
  const [draftMemberIds, setDraftMemberIds] = useState<string[]>([]);
  const [draftDimLabels, setDraftDimLabels] = useState<Record<Dimension, string[]>>(emptyLabelsByDim);
  const [draftDimScopeMode, setDraftDimScopeMode] = useState<Record<Dimension, ScopeMode>>(
    emptyScopeModeByDim
  );
  const draftDimScopeModeRef = useRef(draftDimScopeMode);
  draftDimScopeModeRef.current = draftDimScopeMode;
  const draftDimLabelsRef = useRef(draftDimLabels);
  draftDimLabelsRef.current = draftDimLabels;

  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [pickerSelectedIds, setPickerSelectedIds] = useState<string[]>([]);

  const ensureDefaultAdminRole = useCallback(async (spaceId: string) => {
    const { data: existingRoles, error: existingError } = await supabase
      .schema('firm')
      .from('permission_roles')
      .select('id')
      .eq('firm_space_id', spaceId)
      .limit(1);
    if (existingError) throw new Error(existingError.message);
    if ((existingRoles || []).length > 0) return;

    const { data: userSpaces, error: usError } = await supabase
      .from('user_spaces')
      .select('user_id, is_admin, created_at')
      .eq('space_id', spaceId)
      .order('created_at', { ascending: true });
    if (usError) throw new Error(usError.message);

    const adminMember = (userSpaces || []).find((u: any) => u.is_admin === true) || (userSpaces || [])[0];
    if (!adminMember?.user_id) throw new Error('No firm member found for default Admin role');

    const { data: insertedRole, error: roleErr } = await supabase
      .schema('firm')
      .from('permission_roles')
      .insert({
        firm_space_id: spaceId,
        role_name: 'Admin',
        role_key: 'admin',
        is_system: true,
        member_permissions: {},
        order_permissions: { view: true },
      })
      .select('id')
      .single();
    if (roleErr) throw new Error(roleErr.message);

    const roleId = insertedRole.id as string;
    const nowIso = new Date().toISOString();
    const { error: memberErr } = await supabase.schema('firm').from('permission_role_members').upsert(
      {
        firm_space_id: spaceId,
        role_id: roleId,
        user_id: adminMember.user_id,
        assigned_at: nowIso,
      },
      { onConflict: 'firm_space_id,user_id' }
    );
    if (memberErr) throw new Error(memberErr.message);

    const scopeRows = DIMENSIONS.map((d) => ({
      firm_space_id: spaceId,
      role_id: roleId,
      dimension: d,
      scope_mode: 'all',
      label_ids: [],
      updated_at: nowIso,
    }));
    const { error: scopeErr } = await supabase
      .schema('firm')
      .from('permission_role_scope')
      .upsert(scopeRows, { onConflict: 'role_id,dimension' });
    if (scopeErr) throw new Error(scopeErr.message);
  }, []);

  const loadOrderLabels = useCallback(async (spaceId: string) => {
    const { data, error } = await supabase
      .schema('firm')
      .from('order_labels')
      .select('id, label_name, dimension')
      .eq('firm_space_id', spaceId)
      .order('label_name', { ascending: true });
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    const next: Record<Dimension, OrderLabelRow[]> = { season: [], country: [], scenario: [], custom: [] };
    (data || []).forEach((row: any) => {
      const d = row.dimension as Dimension;
      if (next[d]) next[d].push({ id: row.id, label_name: row.label_name || '' });
    });
    setOrderLabelsByDim(next);
  }, []);

  const load = useCallback(async () => {
    const space = await getCurrentSpace(true);
    if (!space?.id || space.kind !== 'provider') {
      setIsFirmSpace(false);
      setCanManagePermissionRoles(false);
      setLoading(false);
      return;
    }
    setIsFirmSpace(true);
    setFirmSpaceId(space.id);

    const { data: authData } = await supabase.auth.getUser();
    const uid = authData.user?.id;
    let spaceAdmin = false;
    if (uid) {
      const { data: usRow, error: usErr } = await supabase
        .from('user_spaces')
        .select('is_admin')
        .eq('space_id', space.id)
        .eq('user_id', uid)
        .maybeSingle();
      if (!usErr && usRow?.is_admin === true) spaceAdmin = true;
    }
    setCanManagePermissionRoles(spaceAdmin);

    if (spaceAdmin) {
      try {
        await ensureDefaultAdminRole(space.id);
      } catch (e: any) {
        showToast(e?.message || 'Failed to initialize default Admin role', 'error');
      }
    }
    await loadOrderLabels(space.id);

    const [roleRes, memberList] = await Promise.all([
      supabase
        .schema('firm')
        .from('permission_roles')
        .select('id, role_name, role_key, is_system')
        .eq('firm_space_id', space.id)
        .order('created_at', { ascending: true }),
      getFirmSpaceMembers(space.id),
    ]);
    if (roleRes.error) {
      showToast(roleRes.error.message, 'error');
      setRoles([]);
    } else {
      setRoles(
        (roleRes.data || []).map((r: any) => ({
          id: r.id,
          roleName: r.role_name,
          roleKey: r.role_key,
          isSystem: r.is_system === true || r.role_key === 'admin',
        }))
      );
      if (!selectedRoleId && roleRes.data?.[0]?.id) setSelectedRoleId(roleRes.data[0].id);
    }
    setMembers(memberList);
    const roleIds = (roleRes.data || []).map((r: any) => r.id);
    if (roleIds.length > 0) {
      const [memberRows, scopeRows] = await Promise.all([
        supabase
          .schema('firm')
          .from('permission_role_members')
          .select('role_id, user_id')
          .eq('firm_space_id', space.id)
          .in('role_id', roleIds),
        supabase
          .schema('firm')
          .from('permission_role_scope')
          .select('role_id, dimension, scope_mode, label_ids')
          .eq('firm_space_id', space.id)
          .in('role_id', roleIds),
      ]);

      const namesById = new Map<string, string>();
      memberList.forEach((m) => namesById.set(m.id, m.name || m.email || m.id));

      const nextRoleMemberNames: Record<string, string[]> = {};
      (memberRows.data || []).forEach((row: any) => {
        const roleId = row.role_id as string;
        const userId = row.user_id as string;
        if (!nextRoleMemberNames[roleId]) nextRoleMemberNames[roleId] = [];
        nextRoleMemberNames[roleId].push(namesById.get(userId) || userId);
      });
      setRoleMemberNamesByRoleId(nextRoleMemberNames);

      const allScopeLabelIds = Array.from(
        new Set(
          (scopeRows.data || []).flatMap((row: any) =>
            Array.isArray(row.label_ids) ? (row.label_ids as string[]) : []
          )
        )
      );
      let labelNameById: Record<string, string> = {};
      if (allScopeLabelIds.length > 0) {
        const { data: labelRows } = await supabase
          .schema('firm')
          .from('order_labels')
          .select('id, label_name')
          .in('id', allScopeLabelIds);
        labelNameById = (labelRows || []).reduce((acc: Record<string, string>, row: any) => {
          acc[row.id] = row.label_name || row.id;
          return acc;
        }, {});
      }
      const rowsByRoleId = new Map<string, { dimension: string; scope_mode: string; label_ids: unknown }[]>();
      (scopeRows.data || []).forEach((row: any) => {
        const roleId = row.role_id as string;
        if (!rowsByRoleId.has(roleId)) rowsByRoleId.set(roleId, []);
        rowsByRoleId.get(roleId)!.push({
          dimension: row.dimension,
          scope_mode: row.scope_mode,
          label_ids: row.label_ids,
        });
      });
      const nextRoleScopeTags: Record<string, string[]> = {};
      roleIds.forEach((id: string) => {
        nextRoleScopeTags[id] = buildReadScopeTagsForRole(rowsByRoleId.get(id) || [], labelNameById);
      });
      setRoleScopeTagsByRoleId(nextRoleScopeTags);
    } else {
      setRoleMemberNamesByRoleId({});
      setRoleScopeTagsByRoleId({});
    }
    setLoading(false);
  }, [selectedRoleId, ensureDefaultAdminRole, loadOrderLabels]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!loading && !isFirmSpace) {
      showToast('Permissions is available for firm spaces only', 'error');
      router.replace('/management');
    }
  }, [loading, isFirmSpace, router]);

  const resetEditor = useCallback(() => {
    setEditingRoleId(null);
    setEditRoleName('');
    setDraftMemberIds([]);
    setDraftDimLabels(emptyLabelsByDim());
    setDraftDimScopeMode(emptyScopeModeByDim());
    setMemberPickerOpen(false);
    setPickerSelectedIds([]);
  }, []);

  const initDraftAllScope = useCallback(
    (labels: Record<Dimension, OrderLabelRow[]>) => {
      const next = emptyLabelsByDim();
      for (const d of DIMENSIONS) {
        next[d] = labels[d].map((l) => l.id);
      }
      setDraftDimLabels(next);
      setDraftDimScopeMode(emptyScopeModeByDim());
    },
    []
  );

  const openEditRole = useCallback(
    async (role: PermissionRole) => {
      if (!firmSpaceId || !canManagePermissionRoles) return;
      /** Built-in Admin role: no in-app editor (membership / scope managed elsewhere). */
      if (role.roleKey === 'admin') return;
      setEditingRoleId(role.id);
      setSelectedRoleId(role.id);
      setEditRoleName(role.roleName);
      setMemberPickerOpen(false);

      const [memRes, scopeRes] = await Promise.all([
        supabase
          .schema('firm')
          .from('permission_role_members')
          .select('user_id')
          .eq('firm_space_id', firmSpaceId)
          .eq('role_id', role.id),
        supabase
          .schema('firm')
          .from('permission_role_scope')
          .select('dimension, scope_mode, label_ids')
          .eq('firm_space_id', firmSpaceId)
          .eq('role_id', role.id),
      ]);
      setDraftMemberIds((memRes.data || []).map((m: any) => m.user_id));
      const scopeRows = (scopeRes.data || []) as { dimension: string; scope_mode: string; label_ids: unknown }[];
      setDraftDimLabels(buildDraftDimLabelsFromScope(scopeRows, orderLabelsByDim));
      setDraftDimScopeMode(buildDraftDimScopeModeFromScope(scopeRows));
    },
    [firmSpaceId, orderLabelsByDim, canManagePermissionRoles]
  );

  /** Close editor if it ever points at the locked Admin system role */
  useEffect(() => {
    if (!editingRoleId || editingRoleId === 'new') return;
    const role = roles.find((x) => x.id === editingRoleId);
    if (role?.roleKey === 'admin') resetEditor();
  }, [roles, editingRoleId, resetEditor]);

  /** Non-admins are read-only: exit any active role editor */
  useEffect(() => {
    if (!canManagePermissionRoles && editingRoleId) resetEditor();
  }, [canManagePermissionRoles, editingRoleId, resetEditor]);

  const openNewRole = useCallback(() => {
    if (!canManagePermissionRoles) return;
    setEditingRoleId('new');
    setEditRoleName('');
    setDraftMemberIds([]);
    initDraftAllScope(orderLabelsByDim);
    setMemberPickerOpen(false);
  }, [initDraftAllScope, orderLabelsByDim, canManagePermissionRoles]);

  const openMemberPicker = useCallback(() => {
    setPickerSelectedIds([...draftMemberIds]);
    setMemberPickerOpen(true);
  }, [draftMemberIds]);

  const applyMemberPicker = useCallback(() => {
    setDraftMemberIds([...pickerSelectedIds]);
    setMemberPickerOpen(false);
  }, [pickerSelectedIds]);

  const togglePickerMember = useCallback((userId: string) => {
    setPickerSelectedIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }, []);

  const removeDraftMember = useCallback((userId: string) => {
    setDraftMemberIds((prev) => prev.filter((id) => id !== userId));
  }, []);

  /**
   * Scope chips: ALL vs individual labels are mutually exclusive in UI.
   * - ALL on: only ALL is lit; clicking a label turns ALL off and selects only that label (then multi-select works).
   * - Include mode: each label toggles on/off independently.
   * - ALL: click when lit → include with every label selected (then user can narrow); never leave include with zero picks.
   * - If the last include label is turned off, ALL turns back on (empty scope is avoided).
   */
  const toggleDimLabel = useCallback((d: Dimension, labelId: string) => {
    const allIds = orderLabelsByDim[d].map((l) => l.id);
    if (allIds.length === 0) return;
    if (draftDimScopeModeRef.current[d] === 'all') {
      setDraftDimScopeMode((prev) => ({ ...prev, [d]: 'include' }));
      setDraftDimLabels((prev) => ({ ...prev, [d]: [labelId] }));
      return;
    }
    const set = new Set(draftDimLabelsRef.current[d]);
    if (set.has(labelId)) set.delete(labelId);
    else set.add(labelId);
    const nextList = allIds.filter((id) => set.has(id));
    if (nextList.length === 0) {
      setDraftDimScopeMode((prev) => ({ ...prev, [d]: 'all' }));
      setDraftDimLabels((prev) => ({ ...prev, [d]: [...allIds] }));
      return;
    }
    setDraftDimLabels((prev) => ({ ...prev, [d]: nextList }));
  }, [orderLabelsByDim]);

  const selectDimAll = useCallback(
    (d: Dimension) => {
      const allIds = orderLabelsByDim[d].map((l) => l.id);
      if (allIds.length === 0) return;
      if (draftDimScopeModeRef.current[d] === 'all') {
        setDraftDimScopeMode((prev) => ({ ...prev, [d]: 'include' }));
        setDraftDimLabels((prev) => ({ ...prev, [d]: [...allIds] }));
      } else {
        setDraftDimScopeMode((prev) => ({ ...prev, [d]: 'all' }));
        setDraftDimLabels((prev) => ({ ...prev, [d]: [...allIds] }));
      }
    },
    [orderLabelsByDim]
  );

  const handleDeleteRole = useCallback(
    (role: PermissionRole) => {
      if (!canManagePermissionRoles) return;
      if (role.isSystem) {
        showToast('System role cannot be deleted', 'error');
        return;
      }
      confirmDestructive(
        'Delete Role',
        `Are you sure you want to delete "${role.roleName}"?`,
        async () => {
          if (!firmSpaceId) return;
          setSaving(true);
          const { error } = await supabase
            .schema('firm')
            .from('permission_roles')
            .delete()
            .eq('firm_space_id', firmSpaceId)
            .eq('id', role.id);
          setSaving(false);
          if (error) {
            showToast(error.message, 'error');
            return;
          }
          if (selectedRoleId === role.id) setSelectedRoleId(null);
          if (editingRoleId === role.id) resetEditor();
          await load();
        },
        { confirmLabel: 'Delete' }
      );
    },
    [firmSpaceId, load, selectedRoleId, editingRoleId, resetEditor, canManagePermissionRoles]
  );

  const persistMembersForRole = useCallback(
    async (spaceId: string, roleId: string, nextUserIds: string[]) => {
      const { data: existingRows } = await supabase
        .schema('firm')
        .from('permission_role_members')
        .select('user_id')
        .eq('firm_space_id', spaceId)
        .eq('role_id', roleId);
      const existingIds = new Set((existingRows || []).map((r: any) => r.user_id as string));
      const nextSet = new Set(nextUserIds);
      for (const uid of existingIds) {
        if (!nextSet.has(uid)) {
          const { error } = await supabase
            .schema('firm')
            .from('permission_role_members')
            .delete()
            .eq('firm_space_id', spaceId)
            .eq('user_id', uid);
          if (error) throw new Error(error.message);
        }
      }
      const now = new Date().toISOString();
      for (const uid of nextUserIds) {
        const { error } = await supabase.schema('firm').from('permission_role_members').upsert(
          {
            firm_space_id: spaceId,
            role_id: roleId,
            user_id: uid,
            assigned_at: now,
          },
          { onConflict: 'firm_space_id,user_id' }
        );
        if (error) throw new Error(error.message);
      }
    },
    []
  );

  const persistScopesForRole = useCallback(
    async (
      spaceId: string,
      roleId: string,
      dimLabels: Record<Dimension, string[]>,
      dimScopeMode: Record<Dimension, ScopeMode>
    ) => {
      const now = new Date().toISOString();
      const rows = DIMENSIONS.map((d) => {
        const allIds = orderLabelsByDim[d].map((l) => l.id);
        const mode = dimScopeMode[d];
        const label_ids = mode === 'include' ? allIds.filter((id) => dimLabels[d].includes(id)) : [];
        return {
          firm_space_id: spaceId,
          role_id: roleId,
          dimension: d,
          scope_mode: mode,
          label_ids,
          updated_at: now,
        };
      });
      const { error } = await supabase
        .schema('firm')
        .from('permission_role_scope')
        .upsert(rows, { onConflict: 'role_id,dimension' });
      if (error) throw new Error(error.message);
    },
    [orderLabelsByDim]
  );

  const handleSaveEditor = useCallback(async () => {
    if (!firmSpaceId || !canManagePermissionRoles) return;
    if (editingRoleId && editingRoleId !== 'new') {
      const locked = roles.find((x) => x.id === editingRoleId);
      if (locked?.roleKey === 'admin') {
        resetEditor();
        return;
      }
    }
    const name = editRoleName.trim();
    if (!name) {
      showToast('Role name cannot be empty', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editingRoleId === 'new') {
        const roleKey = name.toLowerCase().replace(/\s+/g, '_');
        const { data: inserted, error: insErr } = await supabase
          .schema('firm')
          .from('permission_roles')
          .insert({
            firm_space_id: firmSpaceId,
            role_name: name,
            role_key: roleKey,
            is_system: false,
            member_permissions: {},
            order_permissions: { view: true },
          })
          .select('id')
          .single();
        if (insErr) throw new Error(insErr.message);
        const newId = inserted.id as string;
        await persistMembersForRole(firmSpaceId, newId, draftMemberIds);
        await persistScopesForRole(firmSpaceId, newId, draftDimLabels, draftDimScopeMode);
        showToast('Role created', 'success');
      } else if (editingRoleId) {
        const role = roles.find((r) => r.id === editingRoleId);
        if (!role) throw new Error('Role not found');
        if (!role.isSystem) {
          const roleKey = name.toLowerCase().replace(/\s+/g, '_');
          const { error: updErr } = await supabase
            .schema('firm')
            .from('permission_roles')
            .update({ role_name: name, role_key: roleKey })
            .eq('firm_space_id', firmSpaceId)
            .eq('id', editingRoleId);
          if (updErr) throw new Error(updErr.message);
        }
        await persistMembersForRole(firmSpaceId, editingRoleId, draftMemberIds);
        await persistScopesForRole(firmSpaceId, editingRoleId, draftDimLabels, draftDimScopeMode);
        showToast('Saved', 'success');
      }
      resetEditor();
      await load();
    } catch (e: any) {
      showToast(e?.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }, [
    firmSpaceId,
    editingRoleId,
    editRoleName,
    draftMemberIds,
    draftDimLabels,
    draftDimScopeMode,
    roles,
    persistMembersForRole,
    persistScopesForRole,
    resetEditor,
    load,
    canManagePermissionRoles,
  ]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6C5CE7" />
      </View>
    );
  }

  if (!isFirmSpace) {
    return <View style={styles.center} />;
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <View style={styles.headerTitleContainer}>
          <GradientText
            text="Secure access, clear ownership."
            style={styles.headerTitle}
            containerStyle={styles.gradientTextContainer}
          />
        </View>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Roles</Text>
          {roles.map((r) => {
            const memberTags = roleMemberNamesByRoleId[r.id] || [];
            const scopeTags = roleScopeTagsByRoleId[r.id] || ['ALL'];
            const expanded = canManagePermissionRoles && editingRoleId === r.id;
            return (
              <View key={r.id} style={[styles.card, expanded && styles.roleCardExpanded]}>
                <View style={[styles.roleRowCard, selectedRoleId === r.id && styles.roleRowCardActive]}>
                  <View style={styles.roleRowContent}>
                    {expanded ? (
                      r.isSystem ? (
                        <View style={styles.roleNameRow}>
                          <Text style={styles.roleNameText} numberOfLines={1}>
                            {r.roleName}
                          </Text>
                          <View style={styles.systemBadge}>
                            <Text style={styles.systemBadgeText}>SYS</Text>
                          </View>
                        </View>
                      ) : (
                        <>
                          <Text style={styles.label}>Role name</Text>
                          <TextInput
                            style={styles.roleNameInput}
                            value={editRoleName}
                            onChangeText={setEditRoleName}
                            placeholder="Role name"
                            placeholderTextColor="#95A5A6"
                          />
                        </>
                      )
                    ) : (
                      <TouchableOpacity onPress={() => setSelectedRoleId(r.id)} activeOpacity={0.85}>
                        <View style={styles.roleNameRow}>
                          <Text style={styles.roleNameText} numberOfLines={1}>
                            {r.roleName}
                          </Text>
                          {r.isSystem && (
                            <View style={styles.systemBadge}>
                              <Text style={styles.systemBadgeText}>SYS</Text>
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                    )}

                    {!expanded && (
                      <>
                        <TouchableOpacity onPress={() => setSelectedRoleId(r.id)} activeOpacity={0.85}>
                          <View style={styles.readTagBlock}>
                            <View style={styles.readTagLine}>
                              <View style={styles.readTagIconWrap}>
                                <Ionicons name="people-outline" size={16} color="#636E72" />
                              </View>
                              <View style={styles.readTagsWrap}>
                                {(memberTags.length > 0 ? memberTags : ['No members']).map((tag) => {
                                  const isPlaceholder = tag === 'No members';
                                  return (
                                    <View
                                      key={`${r.id}-m-${tag}`}
                                      style={
                                        isPlaceholder
                                          ? [
                                              styles.metaTag,
                                              styles.scopeLabelChip,
                                              styles.scopeLabelChipMin,
                                              styles.readMemberPlaceholderChip,
                                            ]
                                          : [styles.readMemberPillReadonly, styles.readMemberPillBlue]
                                      }
                                    >
                                      <Text
                                        style={
                                          isPlaceholder
                                            ? [
                                                styles.metaTagText,
                                                styles.scopeLabelChipText,
                                                styles.readMemberPlaceholderText,
                                              ]
                                            : [styles.memberTagLabel, styles.readMemberPillLabelCenter]
                                        }
                                        numberOfLines={1}
                                      >
                                        {tag}
                                      </Text>
                                    </View>
                                  );
                                })}
                              </View>
                            </View>
                            <View style={styles.readTagLine}>
                              <View style={styles.readTagIconWrap}>
                                <Ionicons name="key-outline" size={16} color="#636E72" />
                              </View>
                              <View style={styles.readTagsWrap}>
                                {scopeTags.map((tag) => {
                                  const isAll = tag === 'ALL';
                                  const [bg, fg] = isAll
                                    ? [SCOPE_ALL_LIT_BG, SCOPE_ALL_LIT_FG]
                                    : getScopeLabelColor(tag);
                                  return (
                                    <View
                                      key={`${r.id}-s-${tag}`}
                                      style={[
                                        styles.metaTag,
                                        styles.scopeLabelChip,
                                        styles.scopeLabelChipMin,
                                        { backgroundColor: bg },
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          styles.metaTagText,
                                          styles.scopeLabelChipText,
                                          { color: fg, fontWeight: isAll ? '700' : '600' },
                                        ]}
                                        numberOfLines={1}
                                      >
                                        {tag}
                                      </Text>
                                    </View>
                                  );
                                })}
                              </View>
                            </View>
                          </View>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                  {!expanded && canManagePermissionRoles && r.roleKey !== 'admin' && (
                    <View style={styles.roleRowActions}>
                      <TouchableOpacity style={styles.iconButton} onPress={() => openEditRole(r)} disabled={saving}>
                        <Ionicons name="create-outline" size={18} color="#6C5CE7" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.iconButton}
                        onPress={() => handleDeleteRole(r)}
                        disabled={r.isSystem || saving}
                      >
                        <Ionicons
                          name="trash-outline"
                          size={18}
                          color={r.isSystem ? '#BDC3C7' : '#E74C3C'}
                        />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {expanded && (
                  <View style={styles.roleEditArea}>
                    <Text style={styles.label}>Members</Text>
                    <View style={styles.memberEditRow}>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.memberTagsScroll}>
                        <View style={styles.memberTagsInner}>
                          {draftMemberIds.map((uid) => {
                            const m = members.find((x) => x.id === uid);
                            const label = m?.name || m?.email || uid;
                            return (
                              <View key={uid} style={styles.memberTagPill}>
                                <Text style={styles.memberTagLabel} numberOfLines={1}>
                                  {label}
                                </Text>
                                <TouchableOpacity
                                  style={styles.memberTagRemove}
                                  onPress={() => removeDraftMember(uid)}
                                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                >
                                  <Ionicons name="close" size={11} color="#7F8C8D" />
                                </TouchableOpacity>
                              </View>
                            );
                          })}
                          <TouchableOpacity
                            style={styles.memberAddChip}
                            onPress={openMemberPicker}
                            activeOpacity={0.85}
                            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                          >
                            <Ionicons name="add" size={16} color="#6C5CE7" />
                          </TouchableOpacity>
                        </View>
                      </ScrollView>
                    </View>

                    <View style={styles.permissionScopeSection}>
                      <Text style={styles.label}>Permission scope</Text>
                      <Text style={styles.scopeHint}>
                        Batch grant engagement access by selecting classifications, and authorize related
                        clients access.
                      </Text>
                      <View style={styles.dimGroupsWrap}>
                        {DIMENSIONS.map((d) => {
                          const labels = orderLabelsByDim[d];
                          const selected = new Set(draftDimLabels[d]);
                          const allLit = draftDimScopeMode[d] === 'all';
                          return (
                            <View key={d} style={styles.dimBlock}>
                              <View style={styles.dimTitleRow}>
                                <Text style={styles.dimTitle}>{DIMENSION_LABEL[d]}</Text>
                              </View>
                              {labels.length === 0 ? (
                                <Text style={styles.dimEmpty}>No labels — treated as ALL</Text>
                              ) : (
                                <View style={styles.scopeChipsWrap}>
                                  <TouchableOpacity onPress={() => selectDimAll(d)} activeOpacity={0.85}>
                                    <View
                                      style={[
                                        styles.metaTag,
                                        styles.scopeLabelChip,
                                        styles.scopeLabelChipMin,
                                        {
                                          backgroundColor: allLit ? SCOPE_ALL_LIT_BG : SCOPE_CHIP_UNLIT_BG,
                                        },
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          styles.metaTagText,
                                          styles.scopeLabelChipText,
                                          {
                                            color: allLit ? SCOPE_ALL_LIT_FG : SCOPE_CHIP_MUTED_FG,
                                            fontWeight: allLit ? '700' : '500',
                                          },
                                        ]}
                                        numberOfLines={1}
                                      >
                                        ALL
                                      </Text>
                                    </View>
                                  </TouchableOpacity>
                                  {labels.map((lab) => {
                                    const lit = draftDimScopeMode[d] === 'include' && selected.has(lab.id);
                                    const [bg, fg] = getScopeLabelColor(lab.label_name || lab.id);
                                    return (
                                      <TouchableOpacity
                                        key={lab.id}
                                        onPress={() => toggleDimLabel(d, lab.id)}
                                        activeOpacity={0.85}
                                      >
                                        <View
                                          style={[
                                            styles.metaTag,
                                            styles.scopeLabelChip,
                                            styles.scopeLabelChipMin,
                                            { backgroundColor: lit ? bg : SCOPE_CHIP_UNLIT_BG },
                                          ]}
                                        >
                                          <Text
                                            style={[
                                              styles.metaTagText,
                                              styles.scopeLabelChipText,
                                              {
                                                color: lit ? fg : SCOPE_CHIP_MUTED_FG,
                                                fontWeight: lit ? '600' : '500',
                                              },
                                            ]}
                                            numberOfLines={1}
                                          >
                                            {lab.label_name}
                                          </Text>
                                        </View>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </View>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    </View>

                    <View style={styles.footerActions}>
                      <TouchableOpacity
                        style={[styles.footerBtn, styles.footerBtnSecondary, saving && styles.footerBtnDisabled]}
                        onPress={resetEditor}
                        disabled={saving}
                      >
                        <Text style={styles.footerBtnSecondaryText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.footerBtn, styles.footerBtnPrimary, saving && styles.footerBtnDisabled]}
                        onPress={handleSaveEditor}
                        disabled={saving}
                      >
                        <Text style={styles.footerBtnPrimaryText}>{saving ? 'Saving…' : 'Confirm'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          })}

          {canManagePermissionRoles && editingRoleId === 'new' ? (
            <View style={styles.card}>
              <Text style={styles.label}>New role</Text>
              <Text style={styles.label}>Role name</Text>
              <TextInput
                style={styles.input}
                placeholder="Role name"
                placeholderTextColor="#95A5A6"
                value={editRoleName}
                onChangeText={setEditRoleName}
              />
              <Text style={styles.label}>Members</Text>
              <View style={styles.memberEditRow}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.memberTagsScroll}>
                  <View style={styles.memberTagsInner}>
                    {draftMemberIds.map((uid) => {
                      const m = members.find((x) => x.id === uid);
                      const label = m?.name || m?.email || uid;
                      return (
                        <View key={uid} style={styles.memberTagPill}>
                          <Text style={styles.memberTagLabel} numberOfLines={1}>
                            {label}
                          </Text>
                          <TouchableOpacity
                            style={styles.memberTagRemove}
                            onPress={() => removeDraftMember(uid)}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          >
                            <Ionicons name="close" size={11} color="#7F8C8D" />
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                    <TouchableOpacity
                      style={styles.memberAddChip}
                      onPress={openMemberPicker}
                      activeOpacity={0.85}
                      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                    >
                      <Ionicons name="add" size={16} color="#6C5CE7" />
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              </View>
              <View style={styles.permissionScopeSection}>
                <Text style={styles.label}>Permission scope</Text>
                <Text style={styles.scopeHint}>
                  Batch grant engagement access by selecting engagement classifications, and authorize related clients
                  data access.
                </Text>
                <View style={styles.dimGroupsWrap}>
                  {DIMENSIONS.map((d) => {
                    const labels = orderLabelsByDim[d];
                    const selected = new Set(draftDimLabels[d]);
                    const allLit = draftDimScopeMode[d] === 'all';
                    return (
                      <View key={d} style={styles.dimBlock}>
                        <View style={styles.dimTitleRow}>
                          <Text style={styles.dimTitle}>{DIMENSION_LABEL[d]}</Text>
                        </View>
                        {labels.length === 0 ? (
                          <Text style={styles.dimEmpty}>No labels — treated as ALL</Text>
                        ) : (
                          <View style={styles.scopeChipsWrap}>
                            <TouchableOpacity onPress={() => selectDimAll(d)} activeOpacity={0.85}>
                              <View
                                style={[
                                  styles.metaTag,
                                  styles.scopeLabelChip,
                                  styles.scopeLabelChipMin,
                                  {
                                    backgroundColor: allLit ? SCOPE_ALL_LIT_BG : SCOPE_CHIP_UNLIT_BG,
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.metaTagText,
                                    styles.scopeLabelChipText,
                                    {
                                      color: allLit ? SCOPE_ALL_LIT_FG : SCOPE_CHIP_MUTED_FG,
                                      fontWeight: allLit ? '700' : '500',
                                    },
                                  ]}
                                  numberOfLines={1}
                                >
                                  ALL
                                </Text>
                              </View>
                            </TouchableOpacity>
                            {labels.map((lab) => {
                              const lit = draftDimScopeMode[d] === 'include' && selected.has(lab.id);
                              const [bg, fg] = getScopeLabelColor(lab.label_name || lab.id);
                              return (
                                <TouchableOpacity
                                  key={lab.id}
                                  onPress={() => toggleDimLabel(d, lab.id)}
                                  activeOpacity={0.85}
                                >
                                  <View
                                    style={[
                                      styles.metaTag,
                                      styles.scopeLabelChip,
                                      styles.scopeLabelChipMin,
                                      { backgroundColor: lit ? bg : SCOPE_CHIP_UNLIT_BG },
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.metaTagText,
                                        styles.scopeLabelChipText,
                                        {
                                          color: lit ? fg : SCOPE_CHIP_MUTED_FG,
                                          fontWeight: lit ? '600' : '500',
                                        },
                                      ]}
                                      numberOfLines={1}
                                    >
                                      {lab.label_name}
                                    </Text>
                                  </View>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
              <View style={styles.footerActions}>
                <TouchableOpacity
                  style={[styles.footerBtn, styles.footerBtnSecondary, saving && styles.footerBtnDisabled]}
                  onPress={resetEditor}
                  disabled={saving}
                >
                  <Text style={styles.footerBtnSecondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.footerBtn, styles.footerBtnPrimary, saving && styles.footerBtnDisabled]}
                  onPress={handleSaveEditor}
                  disabled={saving}
                >
                  <Text style={styles.footerBtnPrimaryText}>{saving ? 'Saving…' : 'Confirm'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : canManagePermissionRoles ? (
            <TouchableOpacity style={styles.card} onPress={openNewRole}>
              <View style={styles.addCategoryRow}>
                <Ionicons name="add-circle" size={20} color="#6C5CE7" />
                <Text style={styles.addCategoryText}>Add Role</Text>
              </View>
            </TouchableOpacity>
          ) : null}
        </View>
      </ScrollView>

      <Modal visible={memberPickerOpen} transparent animationType="fade" onRequestClose={() => setMemberPickerOpen(false)}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Select members</Text>
                <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled">
                  {members.map((m) => {
                    const checked = pickerSelectedIds.includes(m.id);
                    return (
                      <TouchableOpacity
                        key={m.id}
                        style={styles.pickerRow}
                        onPress={() => togglePickerMember(m.id)}
                      >
                        <Ionicons
                          name={checked ? 'checkbox' : 'square-outline'}
                          size={22}
                          color={checked ? '#6C5CE7' : '#95A5A6'}
                        />
                        <Text style={styles.pickerRowText} numberOfLines={1}>
                          {m.name || m.email || m.id}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                <View style={styles.footerActions}>
                  <TouchableOpacity
                    style={[styles.footerBtn, styles.footerBtnSecondary]}
                    onPress={() => setMemberPickerOpen(false)}
                  >
                    <Text style={styles.footerBtnSecondaryText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.footerBtn, styles.footerBtnPrimary]} onPress={applyMemberPicker}>
                    <Text style={styles.footerBtnPrimaryText}>Confirm</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  gradientTextContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  section: { marginBottom: 24 },
  /** Match categories-manage `sectionLabel` (e.g. Expense categories) */
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#636E72',
    marginBottom: 4,
    marginTop: 2,
  },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
    marginBottom: 8,
  },
  label: { fontSize: 14, fontWeight: '600', color: '#2D3436' },
  scopeHint: { fontSize: 12, color: '#95A5A6', marginTop: -4 },
  input: {
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#2D3436',
    fontSize: 14,
    backgroundColor: '#FFF',
  },
  /** Unified Cancel / Confirm row (role editor + modals) */
  footerActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
    marginTop: 12,
    width: '100%',
  },
  footerBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  footerBtnSecondary: {
    borderWidth: 1,
    borderColor: '#DDE1E6',
    backgroundColor: '#FFF',
  },
  footerBtnSecondaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#636E72',
  },
  footerBtnPrimary: {
    backgroundColor: '#6C5CE7',
  },
  footerBtnPrimaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },
  footerBtnDisabled: {
    opacity: 0.55,
  },
  roleRowCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  roleCardExpanded: {
    paddingBottom: 6,
  },
  roleRowCardActive: {
    borderRadius: 8,
  },
  roleRowContent: {
    flex: 1,
    paddingRight: 12,
    gap: 3,
    minWidth: 0,
  },
  /** Collapsed role card: member + scope tag rows */
  readTagBlock: {
    marginTop: 0,
    marginLeft: 4,
  },
  readTagLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 26,
    paddingVertical: 1,
  },
  readTagIconWrap: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readTagsWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    rowGap: 8,
  },
  /**
   * Read-only member pill: same height / radius / typography as edit memberTagPill, without remove control.
   */
  readMemberPillReadonly: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    minHeight: MEMBER_TAG_PILL_MIN_HEIGHT,
    maxWidth: 280,
    alignSelf: 'flex-start',
  },
  readMemberPillBlue: {
    backgroundColor: MEMBER_TAG_BLUE_BG,
  },
  readMemberPillLabelCenter: {
    textAlign: 'center',
    ...Platform.select({
      android: { textAlignVertical: 'center' as const, includeFontPadding: false },
      default: {},
    }),
  },
  readMemberPlaceholderChip: {
    backgroundColor: SCOPE_CHIP_UNLIT_BG,
  },
  readMemberPlaceholderText: {
    color: SCOPE_CHIP_MUTED_FG,
    fontWeight: '500',
    fontStyle: 'italic',
  },
  metaTag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: '100%',
    alignSelf: 'flex-start',
    minHeight: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaTagText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    ...Platform.select({
      android: { textAlignVertical: 'center' as const, includeFontPadding: false },
      default: {},
    }),
  },
  roleNameText: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 21,
    color: '#2D3436',
  },
  roleNameInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3436',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#FAFBFC',
  },
  roleNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  systemBadge: {
    height: 16,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  systemBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#4F46E5',
  },
  roleRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleEditArea: {
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#EEF1F4',
    gap: 8,
  },
  memberEditRow: {
    width: '100%',
  },
  memberTagsScroll: { width: '100%', maxHeight: 44 },
  memberTagsInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
    paddingRight: 6,
  },
  memberTagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: MEMBER_TAG_GAP,
    paddingLeft: MEMBER_PILL_PADDING_LEFT,
    paddingRight: MEMBER_PILL_PADDING_RIGHT,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: MEMBER_TAG_BLUE_BG,
    maxWidth: 280,
    minWidth: MEMBER_TAG_MIN_OUTER_WIDTH,
    minHeight: MEMBER_TAG_PILL_MIN_HEIGHT,
  },
  memberTagRemove: {
    width: MEMBER_TAG_REMOVE_SIZE,
    height: MEMBER_TAG_REMOVE_SIZE,
    borderRadius: MEMBER_TAG_REMOVE_SIZE / 2,
    backgroundColor: '#DDE2E7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberTagLabel: {
    flexShrink: 1,
    minWidth: TAG_MIN_TEXT_WIDTH,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: MEMBER_TAG_BLUE_FG,
  },
  /** Add member: circle matching pill row height, inline after last tag */
  memberAddChip: {
    width: MEMBER_TAG_PILL_MIN_HEIGHT,
    height: MEMBER_TAG_PILL_MIN_HEIGHT,
    borderRadius: MEMBER_TAG_PILL_MIN_HEIGHT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#6C5CE7',
    backgroundColor: '#FFF',
  },
  /** Divider only above entire Permission scope block (see permissionScopeSection) */
  permissionScopeSection: {
    borderTopWidth: 1,
    borderTopColor: '#EEF1F4',
    paddingTop: 12,
    gap: 6,
  },
  dimGroupsWrap: {
    gap: 12,
  },
  dimBlock: {
    gap: 6,
  },
  dimTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dimTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2D3436',
    textTransform: 'capitalize',
  },
  dimEmpty: {
    fontSize: 12,
    color: '#95A5A6',
    fontStyle: 'italic',
  },
  scopeChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  scopeLabelChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    minHeight: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scopeLabelChipMin: {
    minWidth: SCOPE_TAG_MIN_OUTER_WIDTH,
  },
  scopeLabelChipText: {
    fontSize: 12,
    lineHeight: 16,
    minWidth: TAG_MIN_TEXT_WIDTH,
    textAlign: 'center',
    ...Platform.select({
      android: { textAlignVertical: 'center' as const, includeFontPadding: false },
      default: {},
    }),
  },
  addCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  addCategoryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6C5CE7',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D3436',
    marginBottom: 12,
  },
  modalList: {
    maxHeight: 320,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F3F5',
  },
  pickerRowText: {
    flex: 1,
    fontSize: 14,
    color: '#2D3436',
  },
});
