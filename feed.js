'use strict';

const got = require('got');
const Autolinker = require('autolinker');

const dateDescending = (a, b) => {
    a = new Date(a.date);
    b = new Date(b.date);

    return a > b ? -1 : a < b ? 1 : 0;
};

let startDate = null;
let endDate = null;

// eslint-disable-next-line no-unused-vars
let action = null;
let page = null;
let pageSize = null;

module.exports = async (activity) => {
    try {
        const token = await accessToken();

        if (token) {
            const accounts = activity.Context.connector.custom2.split(',');
            const hashtags = activity.Context.connector.custom3.split(',');

            let items = [];

            configureRange();

            for (let i = 0; i < accounts.length; i++) {
                const endpoint =
                    activity.Context.connector.endpoint +
                    '/statuses/user_timeline.json?screen_name=' + accounts[i] +
                    '&tweet_mode=extended';

                const response = await got(endpoint, {
                    headers: {
                        Authorization: 'Bearer ' + token
                    }
                });

                const json = JSON.parse(response.body);

                for (let i = 0; i < json.length; i++) {
                    items.push(convertItem(json[i]));
                }
            }

            for (let i = 0; i < hashtags.length; i++) {
                const endpoint =
                    activity.Context.connector.endpoint +
                    '/search/tweets.json?q=%23' + hashtags[i] +
                    '&tweet_mode=extended';

                const response = await got(endpoint, {
                    headers: {
                        Authorization: 'Bearer ' + token
                    }
                });

                const json = JSON.parse(response.body);

                for (let i = 0; i < json.statuses.length; i++) {
                    items.push(convertItem(json.statuses[i]));
                }
            }

            // De-duplicate tweets to compensate API bug
            const result = [];
            const map = new Map();

            for (const item of items) {
                if (!map.has(item.id)) {
                    map.set(item.id, true);
                    result.push(item);
                }
            }

            items = result.sort(dateDescending);

            activity.Response.Data.items = [];

            for (let i = 0; i < items.length; i++) {
                const item = items[i];

                if (!skip(i, items.length, new Date(item.date))) {
                    activity.Response.Data.items.push(item);
                }
            }
        } else {
            activity.Response.ErrorCode = 403;
            activity.Response.Data = {
                ErrorText: 'Access token not granted'
            };
        }
    } catch (error) {
        let m = error.message;

        if (error.stack) {
            m = m + ': ' + error.stack;
        }

        activity.Response.ErrorCode =
            (error.response && error.response.statusCode) || 500;

        if (error.response.statusCode === 404) {
            activity.Response.Data = {
                ErrorText: 'Response code 404: One or more of the source account names may be invalid.'
            };
        } else {
            activity.Response.Data = {
                ErrorText: m
            };
        }
    }

    return activity; // support cloud connectors

    async function accessToken() {
    //eslint-disable-next-line new-cap
        const credentials = new Buffer.from(
            rfcEncode(activity.Context.connector.clientId) +
            ':' +
            rfcEncode(activity.Context.connector.custom1)
        ).toString('base64');

        const opts = {
            method: 'POST',
            headers: {
                Authorization: 'Basic ' + credentials,
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: 'grant_type=client_credentials'
        };

        const response = await got('https://api.twitter.com/oauth2/token', opts);
        const json = JSON.parse(response.body);

        if (json.token_type === 'bearer') {
            return json.access_token;
        }

        return null;
    }

    function configureRange() {
        if (activity.Request.Query.startDate) {
            startDate = convertDate(activity.Request.Query.startDate);
        }

        if (activity.Request.Query.endDate) {
            endDate = convertDate(activity.Request.Query.endDate);
        }

        if (activity.Request.Query.page && activity.Request.Query.pageSize) {
            action = 'firstpage';
            page = parseInt(activity.Request.Query.page, 10);
            pageSize = parseInt(activity.Request.Query.pageSize, 10);

            if (
                activity.Request.Data &&
                activity.Request.Data.args &&
                activity.Request.Data.args.atAgentAction === 'nextpage'
            ) {
                action = 'nextpage';
                page = parseInt(activity.Request.Data.args._page, 10) || 2;
                pageSize = parseInt(activity.Request.Data.args._pageSize, 10) || 20;
            }
        } else if (activity.Request.Query.pageSize) {
            pageSize = parseInt(activity.Request.Query.pageSize, 10);
        } else {
            pageSize = 10;
        }
    }
};

function convertItem(_item) {
    const item = {
        user: {
            id: _item.user.id_str,
            screenName: _item.user.screen_name,
            name: _item.user.name
        },
        id: _item.id_str,
        favourites: _item.favorite_count,
        retweets: _item.retweet_count,
        date: new Date(_item.created_at).toISOString(),
        link: 'https://twitter.com/statuses/' + _item.id_str
    };

    // Strip t.co URLs
    if (
        _item.full_text.lastIndexOf(' https://t.co/') !== -1 &&
        _item.full_text.charAt(_item.full_text.length - 1) !== '…'
    ) {
        item.text = _item.full_text.substring(
            0,
            _item.full_text.lastIndexOf(' https://t.co/')
        );
    } else {
        item.text = _item.full_text;
    }

    // Link autolinkable elements
    item.text = Autolinker.link(item.text, {
        hashtag: 'twitter',
        mention: 'twitter'
    });

    // Add thumbnail url if present
    if (_item.extended_entities && _item.extended_entities.media) {
        item.thumbnail = _item.extended_entities.media[0].media_url_https;
    }

    // Add user avatar if present
    if (_item.user.profile_image_url_https) {
        item.user.avatar = _item.user.profile_image_url_https;
    }

    // Link symbol ($ financial) entities if present
    if (_item.entities.symbols && _item.entities.symbols.length > 0) {
        const regex = /\$[A-Za-z]{1,6}([._][A-Za-z]{1,2})?/g;
        const matches = _item.full_text.match(regex);

        if (matches) {
            for (let i = 0; i < matches.length; i++) {
                const enc = matches[i].replace('$', '%24');

                item.text = item.text.replace(
                    matches[i],
                    '<a href="https://twitter.com/search?q=' +
                    enc +
                    '" target="_blank" rel="noopener noreferrer">' +
                    matches[i] +
                    '</a>'
                );
            }
        }
    }

    // Add the at-click-action and blue colour class to links
    item.text = item.text.replace(
        /<a href/g,
        '<a class="blue" at-click-action="select" href'
    );

    return item;
}

function rfcEncode(key) {
    return encodeURIComponent(key)
        .replace(/!/g, '%21')
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/\*/g, '%2A');
}

function convertDate(date) {
    return new Date(
        date.substring(0, 4),
        date.substring(4, 6) - 1,
        date.substring(6, 8)
    );
}

function skip(i, length, date) {
    if (startDate && endDate) {
        return date < startDate || date > endDate;
    } else if (startDate) {
        return date < startDate;
    } else if (endDate) {
        return date > endDate;
    } else if (page && pageSize) {
        const startItem = Math.max(page - 1, 0) * pageSize;

        let endItem = startItem + pageSize;

        if (endItem > length) {
            endItem = length;
        }

        return i < startItem || i >= endItem;
    } else if (pageSize) {
        return i > pageSize - 1;
    } else {
        return false;
    }
}
