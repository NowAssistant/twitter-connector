const got = require('got');
const Autolinker = require('autolinker');

const dateDescending = (a, b) => {
    a = new Date(a.date);
    b = new Date(b.date);
        
    return a > b ? -1 : (a < b ? 1 : 0);
}

let startDate = null;
let endDate = null;

let action = null;
let page = null;
let pageSize = null;

module.exports = async activity => {
    try {
        const token = await access_token();

        if (token) {
            const accounts = activity.Context.connector.custom2.split(',');
            const hashtags = activity.Context.connector.custom3.split(',');

            let items = [];

            configure_range();

            for (let i = 0; i < accounts.length; i++) {
                const endpoint = 
                    activity.Context.connector.endpoint + 
                    '/statuses/user_timeline.json?screen_name=' + accounts[i] + 
                    '&tweet_mode=extended';

                const response = await got(endpoint, {
                    headers: {
                        'Authorization': 'Bearer ' + token
                    }
                });

                const json = JSON.parse(response.body);

                for (let i = 0; i < json.length; i++) {
                    items.push(
                        convert_item(json[i])
                    );
                }
            }

            for (let i = 0; i < hashtags.length; i++) {
                const endpoint = 
                    activity.Context.connector.endpoint + 
                    '/search/tweets.json?q=%23' + hashtags[i] + 
                    '&tweet_mode=extended';

                const response = await got(endpoint, {
                    headers: {
                        'Authorization': 'Bearer ' + token
                    }
                });

                const json = JSON.parse(response.body);

                for (let i = 0; i < json.statuses.length; i++) {
                    items.push(
                        convert_item(json.statuses[i])
                    );
                }
            }

            items = items.sort(dateDescending);

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
        var m = error.message;  

        if (error.stack) {
            m = m + ': ' + error.stack;
        }

        activity.Response.ErrorCode = 
            (error.response && error.response.statusCode) || 500;

        activity.Response.Data = {
            ErrorText: m
        };
    }

    return activity; // support cloud connectors

    async function access_token() {
        const credentials = new Buffer.from(
            rfc_encode(activity.Context.connector.clientId) + ':' + 
            rfc_encode(activity.Context.connector.custom1)
        ).toString('base64');

        const opts = {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + credentials,
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: 'grant_type=client_credentials'
        };

        const response = await got('https://api.twitter.com/oauth2/token', opts);
        const json = JSON.parse(response.body);

        if (json.token_type == 'bearer') {
            return json.access_token;
        }

        return null;
    }
    
    function configure_range() {
        if (activity.Request.Query.startDate) {
            startDate = convert_date(activity.Request.Query.startDate);
        }

        if (activity.Request.Query.endDate) {
            endDate = convert_date(activity.Request.Query.endDate);
        }

        if (activity.Request.Query.page && activity.Request.Query.pageSize) {
            action = "firstpage"
            page = parseInt(activity.Request.Query.page);
            pageSize = parseInt(activity.Request.Query.pageSize);

            if (activity.Request.Data &&
                activity.Request.Data.args &&
                activity.Request.Data.args.atAgentAction == "nextpage") {
                    action = "nextpage";
                    page = parseInt(activity.Request.Data.args._page) || 2;
                    pageSize = parseInt(activity.Request.Data.args._pageSize) || 20;
            }
        } else if (activity.Request.Query.pageSize) {
            pageSize = parseInt(acitivty.Request.Query.pageSize);
        } else {
            pageSize = 10;
        }
    }
};

function convert_item(_item) {
    const item = {
        user: {
            id: _item.user.id_str,
            screen_name: _item.user.screen_name,
            name: _item.user.name
        },
        id: _item.id_str,
        text: Autolinker.link(_item.full_text, {
            hashtag: 'twitter',
            mention: 'twitter'
        }),
        favourites: _item.favorite_count,
        retweets: _item.retweet_count,
        date: new Date(_item.created_at).toISOString(),
        link: 'https://twitter.com/statuses/' + _item.id_str 
    };

    if (_item.extended_entities && _item.extended_entities.media) {
        item.thumbnail = _item.extended_entities.media[0].media_url_https;
    }

    if (_item.entities.symbols && _item.entities.symbols.length > 0) {
        const regex = /\$[A-Za-z]{1,6}([._][A-Za-z]{1,2})?/g;
        const matches = _item.full_text.match(regex);

        if (matches) {
            for (let i = 0; i < matches.length; i++) {
                const enc = matches[i].replace('$', '%24');

                item.text = item.text
                    .replace(
                        matches[i],
                        '<a href="https://twitter.com/search?q=' + 
                        enc + 
                        '" target="_blank" rel="noopener noreferrer">' + 
                        matches[i] + 
                        '</a>');
            }
        }
    }

    item.text = item.text.replace(/<a href/g, '<a class="blue" href');

    return item;
}

function rfc_encode(key) {
    return encodeURIComponent(key)
        .replace(/!/g, '%21')
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/\*/g, '%2A');
}

function convert_date(date) {
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
        const endItem = startItem + pageSize;

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