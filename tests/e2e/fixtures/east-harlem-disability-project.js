import {
  createDefaultProject,
  createLevelProgress,
  serializeProject,
  stableId,
  validateProject,
} from '../../../src/domain.js';

const FIXED_TIME = '2026-08-29T16:00:00.000Z';
const MEMO = `A fictional East Harlem resident uses a neighborhood disability resource center and attends its peer support group. A home attendant assists the resident in an apartment building and coordinates appointment reminders with a resource navigator. The resource center hosts the peer group and helps the resident organize access needs.

A mobility scheduling office makes decisions outside those immediate settings. Its booking rules determine whether the resident can reach the resource center on time. State home care reimbursement policy shapes the attendant's available hours and the support that can be provided at home. This classroom case is fabricated and contains no information about a real person or organization.`;

function annotations(id) {
  return {
    analytical: { id: `annotation_${id}_analytical`, text: '' },
    evidence: { id: `annotation_${id}_evidence`, text: '' },
  };
}

function node({ id, label, type, scale, x, y, evidence, ...levelFields }) {
  return {
    id,
    label,
    type,
    scale,
    status: 'confirmed',
    claimState: 'student interpretation',
    notes: '',
    x,
    y,
    annotations: annotations(id),
    evidence,
    origin: 'student entry',
    reviewDecision: 'added',
    ...levelFields,
  };
}

function edge({ id, source, target, sourceLabel, targetLabel, verb, scale, evidence }) {
  return {
    id,
    source,
    target,
    sourceLabel,
    targetLabel,
    verb,
    scale,
    status: 'confirmed',
    claimState: 'student interpretation',
    notes: '',
    directed: true,
    confidence: 1,
    rationale: evidence,
    evidence,
    annotation: { id: `annotation_${id}_relationship`, text: '' },
    origin: 'student entry',
    reviewDecision: 'added',
  };
}

export function buildEastHarlemDisabilityProject() {
  const project = createDefaultProject();
  const homeId = 'node_e2e_home_setting';
  const centerId = 'node_e2e_resource_center';
  const residentId = 'node_e2e_resident';
  const attendantId = 'node_e2e_home_attendant';
  const groupId = 'node_e2e_peer_support_group';
  const navigatorId = 'node_e2e_resource_navigator';
  const mesoId = 'node_e2e_home_center_coordination';
  const exoId = 'node_e2e_mobility_scheduling_office';
  const macroId = 'node_e2e_home_care_policy';

  const nodes = [
    node({ id: homeId, label: 'Apartment building', type: 'setting', scale: 'micro', x: 1260, y: 1150, evidence: 'The resident receives support in an apartment building.', focalParticipation: 'direct', settingNodeIds: [] }),
    node({ id: centerId, label: 'Disability resource center', type: 'setting', scale: 'micro', x: 1510, y: 1190, evidence: 'The resident uses a neighborhood disability resource center.', focalParticipation: 'direct', settingNodeIds: [] }),
    node({ id: residentId, label: 'Resident', type: 'person', scale: 'micro', x: 1370, y: 1010, evidence: 'The fictional resident participates directly in the mapped settings.', focalParticipation: 'direct', settingNodeIds: [homeId, centerId] }),
    node({ id: attendantId, label: 'Home attendant', type: 'role', scale: 'micro', x: 1160, y: 1300, evidence: 'A home attendant assists the resident in the apartment building.', focalParticipation: 'direct', settingNodeIds: [homeId] }),
    node({ id: groupId, label: 'Peer support group', type: 'group', scale: 'micro', x: 1600, y: 1330, evidence: 'The resident attends a peer support group at the resource center.', focalParticipation: 'direct', settingNodeIds: [centerId] }),
    node({ id: navigatorId, label: 'Resource navigator', type: 'role', scale: 'micro', x: 1450, y: 1410, evidence: 'A resource navigator coordinates appointment reminders.', focalParticipation: 'direct', settingNodeIds: [centerId] }),
    node({ id: mesoId, label: 'Home–resource center coordination', type: 'mesosystem', scale: 'meso', x: 2170, y: 1210, evidence: 'The attendant and resource navigator coordinate appointment reminders across home and the resource center.', scopeNodeIds: [homeId, centerId], mesoExplanation: 'Coordination connects support in the home with activity at the resource center.' }),
    node({ id: exoId, label: 'Mobility Scheduling Office', type: 'agency', scale: 'exosphere', x: 2640, y: 1210, evidence: 'The mobility scheduling office makes booking decisions outside the resident’s immediate settings.', basis: 'memo' }),
    node({ id: macroId, label: 'State home care reimbursement policy', type: 'policy', scale: 'macrosphere', x: 3030, y: 1210, evidence: 'State reimbursement policy shapes available attendant hours and support at home.', basis: 'memo', deontic: 'shapes', scopeNodeIds: [homeId, attendantId, residentId] }),
  ];

  const nodeById = new Map(nodes.map((item) => [item.id, item]));
  const edges = [
    edge({ id: 'edge_e2e_attendant_assists_resident', source: attendantId, target: residentId, sourceLabel: nodeById.get(attendantId).label, targetLabel: nodeById.get(residentId).label, verb: 'assists', scale: 'meso', evidence: 'The home attendant assists the resident.' }),
    edge({ id: 'edge_e2e_resident_attends_group', source: residentId, target: groupId, sourceLabel: nodeById.get(residentId).label, targetLabel: nodeById.get(groupId).label, verb: 'attends', scale: 'meso', evidence: 'The resident attends the peer support group.' }),
    edge({ id: 'edge_e2e_center_hosts_group', source: centerId, target: groupId, sourceLabel: nodeById.get(centerId).label, targetLabel: nodeById.get(groupId).label, verb: 'hosts', scale: 'meso', evidence: 'The resource center hosts the peer support group.' }),
    edge({ id: 'edge_e2e_navigator_reminds_resident', source: navigatorId, target: residentId, sourceLabel: nodeById.get(navigatorId).label, targetLabel: nodeById.get(residentId).label, verb: 'reminds', scale: 'meso', evidence: 'The resource navigator coordinates appointment reminders with the resident.' }),
    edge({ id: 'edge_e2e_office_rules_center', source: exoId, target: centerId, sourceLabel: nodeById.get(exoId).label, targetLabel: nodeById.get(centerId).label, verb: 'sets rules for', scale: 'exosphere', evidence: 'Booking rules determine whether the resident can reach the resource center on time.' }),
  ];

  Object.assign(project, {
    id: 'project_e2e_east_harlem_disability_resources',
    title: 'East Harlem disability resources',
    participantName: 'Fictional classroom case',
    inquiry: 'How do immediate settings, their interrelations, outside decisions, and broader policy shape access to disability resources?',
    activeScale: 'macrosphere',
    releasedScales: ['micro', 'meso', 'exosphere', 'macrosphere'],
    completedScales: ['micro', 'meso', 'exosphere'],
    stage: 3,
    furthestStage: 3,
    levelProgress: createLevelProgress({
      activeScale: 'macrosphere',
      stage: 3,
      completedScales: ['micro', 'meso', 'exosphere'],
    }),
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    submission: {
      ...project.submission,
      id: 'submission_e2e_east_harlem_disability_resources',
      title: 'Fabricated East Harlem disability resources memo',
      author: 'Fabricated classroom case',
      date: '2026-08-29',
      sourceType: 'teacher-created memo',
      location: 'East Harlem classroom scenario',
      rights: 'Course testing only',
      sensitive: false,
      consent: false,
      evidenceOwnership: 'All people and organizations in this fixture are fabricated.',
      text: MEMO,
      fingerprint: stableId('src', MEMO),
    },
    preflight: null,
    candidates: { nodes: [], edges: [] },
    graph: { nodes, edges },
    viewport: { panX: 0, panY: 0, zoom: 1 },
    mapAnnotation: { id: 'annotation_project_e2e_map', text: '' },
    reflection: '',
    events: [{
      id: 'event_e2e_project_created',
      action: 'project.created',
      detail: 'Created a fabricated cumulative map for accessibility verification',
      actor: 'student',
      at: FIXED_TIME,
    }],
  });

  return validateProject(project);
}

export function serializedEastHarlemDisabilityProject() {
  return serializeProject(buildEastHarlemDisabilityProject());
}
