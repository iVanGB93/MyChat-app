/** Public foreground maintenance API; Play remains the version authority. */
export {appUpdates,startAppMaintenance} from '../../composition/appMaintenance';

export {appDestinations,openAppDestination} from '../../services/appDestinations';
export {startDiagnosticLifecycle} from '../../services/mobileDiagnosticLifecycle';
export {getDiagnosticBuildInfo} from '../../../modules/axonic-app-update/src';
