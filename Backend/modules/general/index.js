const pagesRouter = require('./pages.router');
const settingsRouter = require('./settings.router');
const assistantRouter = require('./assistant.router');
const uploadRouter = require('./upload.router');
const verificationRouter = require('./verification.router');
const feedsRouter = require('./feeds.router');
const servicesRouter = require('./services.router');
const indexRouter = require('./index.router');
const serviceService = require('./service.service');
const templateGenerator = require('./template_generator.service');

module.exports = {
    pagesRouter,
    settingsRouter,
    assistantRouter,
    uploadRouter,
    verificationRouter,
    feedsRouter,
    servicesRouter,
    indexRouter,
    serviceService,
    templateGenerator
};
