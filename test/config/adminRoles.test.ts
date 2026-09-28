import { expect } from 'chai';

import { ADMIN_PERMISSIONS, ADMIN_ROLES, ROLE_PERMISSIONS, can, isAdminRole } from '../../config/adminRoles';

describe('admin roles', () => {
  it('gives operations every permission', () => {
    expect([...ROLE_PERMISSIONS.operations]).to.deep.equal([...ADMIN_PERMISSIONS]);
  });

  it('keeps the CEO view-only apart from opening a recovery ticket', () => {
    const nonView = ROLE_PERMISSIONS.ceo.filter((permission) => !permission.endsWith(':view'));
    expect(nonView).to.deep.equal(['recovery:request']);
    expect(can('ceo', 'mint:approve')).to.equal(false);
    expect(can('ceo', 'token:pause')).to.equal(false);
  });

  it('lets compliance review KYC, freeze and resolve exceptions but not move tokens', () => {
    expect(can('compliance', 'kyc:review')).to.equal(true);
    expect(can('compliance', 'investors:freeze')).to.equal(true);
    expect(can('compliance', 'exceptions:resolve')).to.equal(true);
    for (const permission of ['token:mint', 'token:burn', 'token:pause', 'mint:approve', 'recovery:approve'] as const) {
      expect(can('compliance', permission), permission).to.equal(false);
    }
  });

  it('only operations approves 100k mints and recovery', () => {
    for (const permission of ['mint:approve', 'recovery:approve', 'team:manage'] as const) {
      expect(ADMIN_ROLES.filter((role) => can(role, permission))).to.deep.equal(['operations']);
    }
  });

  it('recognises role names', () => {
    expect(isAdminRole('compliance')).to.equal(true);
    expect(isAdminRole('admin')).to.equal(false);
    expect(isAdminRole(undefined)).to.equal(false);
  });
});
