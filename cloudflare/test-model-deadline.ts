// Local runtime harness only. Never referenced by a release configuration.
export { MappingCourse } from './worker';
import { createMappingHandler } from './worker';
export default createMappingHandler({ testOnlyGuidanceTimeoutMs: 1500 });
