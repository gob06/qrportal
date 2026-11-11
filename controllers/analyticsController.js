const analyticsService = require('../services/analyticsService');
const orgModel = require('../models/organizationModel');

async function analyticsPage(req, res, next) {
  try {
    const orgId = req.query.org ? parseInt(req.query.org, 10) : null;
    const org = orgId ? await orgModel.findById(orgId) : null;
    const [summary, daily, perOrg, recent] = await Promise.all([
      analyticsService.summary(org ? org.id : null),
      analyticsService.dailySeries(30, org ? org.id : null),
      analyticsService.perOrganization(20),
      analyticsService.recentScans(15)
    ]);
    res.render('admin/analytics', { summary, daily, perOrg, recent, org });
  } catch (err) {
    next(err);
  }
}

module.exports = { analyticsPage };
