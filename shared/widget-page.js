/** @decorator */

import { Page } from './page.js';
import { invalidate, validate } from './validate.js';
import { Observable, observable } from './element/observation/observable.js';
import { DOM } from './element/dom.js';
import { NotFoundError } from './http-errors.js';
import { Denormalization } from './ppp-denormalize.js';
import { debounce } from './ppp-throttle.js';
import ppp from '../ppp.js';

export class WidgetPage extends Page {
  collection = 'widgets';

  denormalization = new Denormalization();

  savedInstrument;

  savedWidth;

  savedHeight;

  @observable
  loading;

  @observable
  widgetDefinition;

  constructor() {
    super();

    this.onDocumentReady = this.onDocumentReady.bind(this);
    this.onChange = this.onChange.bind(this);
    this.widgetDefinition = {};
  }

  async validate() {
    await validate(this.name);

    if (typeof this.widgetDefinition?.customElement !== 'function') {
      invalidate(this.url, {
        errorMessage: 'Этот виджет не может быть загружен.',
        raiseException: true
      });
    }

    if (this.document.type === 'custom' && this.url?.isConnected) {
      await validate(this.url);

      try {
        new URL(this.url.value);
        await fetch(this.url.value, {
          cache: 'no-cache'
        });
      } catch (e) {
        this.widgetDefinition = {};

        invalidate(this.url, {
          errorMessage: 'Неверный или неполный URL',
          raiseException: true
        });
      }
    }

    if (typeof this.widgetElement?.validate === 'function')
      return this.widgetElement.validate();
  }

  async read() {
    return (context) => {
      return context.services
        .get('mongodb-atlas')
        .db('ppp')
        .collection('[%#this.page.view.collection%]')
        .aggregate([
          {
            $match: {
              _id: new BSON.ObjectId('[%#payload.documentId%]')
            }
          },
          {
            $lookup: {
              from: 'apis',
              pipeline: [
                {
                  $project: {
                    updatedAt: 0,
                    createdAt: 0,
                    version: 0
                  }
                }
              ],
              as: 'apis'
            }
          },
          {
            $lookup: {
              from: 'traders',
              pipeline: [
                {
                  $project: {
                    updatedAt: 0,
                    createdAt: 0,
                    version: 0
                  }
                }
              ],
              as: 'traders'
            }
          },
          {
            $lookup: {
              from: 'brokers',
              pipeline: [
                {
                  $project: {
                    updatedAt: 0,
                    createdAt: 0,
                    version: 0
                  }
                }
              ],
              as: 'brokers'
            }
          },
          {
            $lookup: {
              from: 'bots',
              pipeline: [
                {
                  $project: {
                    updatedAt: 0,
                    createdAt: 0,
                    version: 0,
                    webhook: 0,
                    type: 0
                  }
                }
              ],
              as: 'bots'
            }
          },
          {
            $lookup: {
              from: 'services',
              pipeline: [
                {
                  $project: {
                    updatedAt: 0,
                    createdAt: 0,
                    version: 0,
                    constsCode: 0,
                    formatterCode: 0,
                    instrumentsCode: 0,
                    symbolsCode: 0,
                    environmentCode: 0,
                    sourceCode: 0,
                    parsingCode: 0,
                    tableSchema: 0,
                    insertTriggerCode: 0,
                    deleteTriggerCode: 0,
                    proxyHeaders: 0
                  }
                }
              ],
              as: 'services'
            }
          }
        ]);
    };
  }

  async transform() {
    this.denormalization.fillRefs(this.document);

    return await this.denormalization.denormalize(this.document);
  }

  async find() {
    return {
      name: this.name.value.trim(),
      removed: { $ne: true }
    };
  }

  async update() {
    let widgetUpdateResult = {};

    const $set = {
      name: this.name.value.trim(),
      reportedType: this.widgetDefinition.type,
      updatedAt: new Date()
    };

    const $setOnInsert = {
      type: this.document.type,
      collection: this.widgetDefinition.collection,
      createdAt: new Date()
    };

    if (this.document.type === 'custom') {
      $setOnInsert.url = this.url.value.trim();
    }

    const result = {
      $set,
      $setOnInsert
    };

    if (typeof this.widgetElement?.update === 'function') {
      widgetUpdateResult = await this.widgetElement.update();

      if (typeof widgetUpdateResult === 'object') {
        for (const key in widgetUpdateResult) {
          result[key] = Object.assign(
            {},
            result[key] ?? {},
            widgetUpdateResult[key]
          );
        }
      }
    }

    return result;
  }

  getWidgetTagName() {
    if (this.document.type === 'custom' && !this.document.url) return null;

    if (typeof this.widgetDefinition?.customElement === 'function') {
      return this.widgetDefinition.customElement().definition.baseName;
    }
  }

  getWidgetUrl() {
    const type = this.document.type;

    if (!type) {
      throw new NotFoundError({ documentId: ppp.app.params().document });
    }

    if (type === 'custom') {
      if (this.document.url) return this.document.url;

      return this.url?.value ? new URL(this.url?.value).toString() : '';
    } else {
      return `${ppp.rootUrl}/${ppp.appType}/${ppp.theme}/${type}-widget.js`;
    }
  }

  async loadWidget(url = this.getWidgetUrl()) {
    this.loading = true;

    if (!url && this.document.type === 'custom') {
      this.widgetDefinition.settings = null;
      this.widgetDefinition.title = 'По ссылке';
      this.widgetDefinition.tags = ['Загружаемый виджет'];
      this.widgetDefinition.collection = null;
      this.widgetDefinition.loaded = false;
      this.widgetDefinition.description =
        'Укажите URL в секции базовых настроек и примените изменения (если не включено автоматическое принятие), чтобы продолжить.';

      this.loading = false;

      Observable.notify(this, 'widgetDefinition');
    }

    if (url) {
      this.beginOperation();

      try {
        const module = await import(url);
        const wUrl = new URL(url);
        const baseWidgetUrl = wUrl.href.slice(0, wUrl.href.lastIndexOf('/'));

        this.widgetDefinition = await module.widgetDefinition?.({
          ppp,
          baseWidgetUrl
        });

        if (typeof this.widgetDefinition?.customElement !== 'function') {
          invalidate(this.url, {
            errorMessage: 'Этот виджет не может быть загружен.',
            raiseException: true
          });
        }

        ppp.DesignSystem.getOrCreate().register(
          this.widgetDefinition.customElement()
        );

        this.widgetDefinition.loaded = true;
        this.loading = false;

        Observable.notify(this, 'widgetDefinition');
      } catch (e) {
        this.failOperation(e);
      } finally {
        this.endOperation();
      }
    }
  }

  connectedCallback() {
    this.addEventListener('ready', this.onDocumentReady);

    super.connectedCallback();
  }

  disconnectedCallback() {
    this.removeEventListener('ready', this.onDocumentReady);
    this.removeEventListener('change', this.onChange);
    this.removeEventListener('input', this.onChange);

    super.disconnectedCallback();
  }

  onChange(event) {
    if (!this.autoApplyModifications.checked) return true;

    // Discard input onChange
    if (
      event.type === 'change' &&
      event
        .composedPath()
        .find((n) => n.tagName?.toLowerCase()?.startsWith('ppp-text'))
    )
      return true;

    if (event.composedPath().find((n) => n.classList?.contains('widget-area')))
      return true;

    this.onChangeDelayed(event);

    return true;
  }

  async applyModifications() {
    this.page.loading = true;

    await this.onChangeDelayedAsync();
  }

  async onChangeDelayedAsync() {
    try {
      let documentAfterChanges;

      this.savedInstrument = this.widgetElement?.instrument;

      if (this.widgetElement?.isConnected) {
        this.savedWidth = parseInt(this.widgetElement?.style?.width);
        this.savedHeight = parseInt(this.widgetElement?.style?.height);
      }

      const urlObject = {};

      if (this.document.type === 'custom' && this.url?.isConnected) {
        urlObject.url = this.url.value ?? '';
      }

      if (typeof this.widgetElement?.update === 'function') {
        const updates = await this.widgetElement?.update({ preview: true });

        documentAfterChanges = await this.denormalization.denormalize(
          Object.assign(
            {},
            this.document,
            updates.$set ?? {},
            {
              name: this.name.value
            },
            urlObject
          )
        );
      } else {
        documentAfterChanges = await this.denormalization.denormalize(
          Object.assign(
            {},
            this.document,
            {
              name: this.name.value
            },
            urlObject
          )
        );
      }

      this.document = Object.assign({}, documentAfterChanges ?? {});

      if (!this.document._id) {
        this.document = await this.denormalizePartialDocument();
      }

      await validate(this.name);

      if (this.document.type === 'custom' && this.url?.isConnected) {
        await validate(this.url);

        try {
          new URL(this.url.value);
          await fetch(this.url.value, {
            cache: 'no-cache'
          });
        } catch (e) {
          this.widgetDefinition = {};

          invalidate(this.url, {
            errorMessage: 'Неверный или неполный URL',
            raiseException: true
          });
        }
      }

      if (this.document.type === 'custom' && !this.widgetDefinition.loaded) {
        await this.loadWidget();
      }

      if (typeof this.widgetElement?.validate === 'function')
        await this.widgetElement.validate();
    } finally {
      // Force widget connectedCallback
      DOM.queueUpdate(() => (this.page.loading = false));
    }
  }

  @debounce(1000)
  onChangeDelayed(event) {
    this.page.loading = true;

    return void this.onChangeDelayedAsync(event);
  }

  async denormalizePartialDocument() {
    const lines = ((context) => {
      return context.services
        .get('mongodb-atlas')
        .db('ppp')
        .collection('app')
        .aggregate([
          {
            $match: {
              _id: '@settings'
            }
          },
          {
            $lookup: {
              from: 'apis',
              pipeline: [
                {
                  $project: {
                    updatedAt: 0,
                    createdAt: 0,
                    version: 0
                  }
                }
              ],
              as: 'apis'
            }
          },
          {
            $lookup: {
              from: 'traders',
              pipeline: [
                {
                  $project: {
                    updatedAt: 0,
                    createdAt: 0,
                    version: 0
                  }
                }
              ],
              as: 'traders'
            }
          },
          {
            $lookup: {
              from: 'brokers',
              pipeline: [
                {
                  $project: {
                    updatedAt: 0,
                    createdAt: 0,
                    version: 0
                  }
                }
              ],
              as: 'brokers'
            }
          },
          {
            $lookup: {
              from: 'bots',
              pipeline: [
                {
                  $project: {
                    updatedAt: 0,
                    createdAt: 0,
                    version: 0,
                    webhook: 0,
                    type: 0
                  }
                }
              ],
              as: 'bots'
            }
          },
          {
            $lookup: {
              from: 'services',
              pipeline: [
                {
                  $project: {
                    updatedAt: 0,
                    createdAt: 0,
                    version: 0,
                    constsCode: 0,
                    formatterCode: 0,
                    instrumentsCode: 0,
                    symbolsCode: 0,
                    environmentCode: 0,
                    sourceCode: 0,
                    parsingCode: 0,
                    tableSchema: 0,
                    insertTriggerCode: 0,
                    deleteTriggerCode: 0,
                    proxyHeaders: 0
                  }
                }
              ],
              as: 'services'
            }
          }
        ]);
    })
      .toString()
      .split(/\r?\n/);

    lines.pop();
    lines.shift();

    const [evalRequest] = await ppp.user.functions.eval(lines.join('\n'));

    this.denormalization.fillRefs(evalRequest);

    return this.denormalization.denormalize(this.document);
  }

  async onDocumentReady() {
    if (!this.lastError) {
      if (!this.document.type) {
        this.document.type = ppp.app.params().type ?? 'order';
      }

      Observable.notify(this, 'document');

      DOM.queueUpdate(() => {
        this.addEventListener('change', this.onChange);
        this.addEventListener('input', this.onChange);
      });
    }
  }

  async handleWidgetTypeChange(event) {
    if (!this.document._id) {
      this.widgetDefinition = {};
      this.savedInstrument = void 0;
      this.savedWidth = void 0;
      this.savedHeight = void 0;

      const name = this.name.value.trim();

      this.document.type = event.target.value;

      ppp.app.setURLSearchParams({
        type: this.document.type
      });

      Observable.notify(this, 'document');
      DOM.queueUpdate(() => (this.name.value = name));
    }

    await this.loadWidget();
  }
}
