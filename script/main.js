'use strict';

var $tabLinks = $('.nav-tabs li a');

var Tabs = {
    init: function() {
        $tabLinks.click(function(e) {
            if ($(this.hash).length === 0) {
                // treat link like normal-- we're on a subpage and not a tab
                window.location = '/' + this.hash;
            } else {
                window.location.hash = '';
            }

            // Show the specified tab
            $('.background div').hide();
            $('#'+$(this).attr('aria-controls')+'-background').fadeIn(600);
        });

        if (window.location.hash) {
            $tabLinks.each(function(i, link) {
                if (window.location.hash == link.hash) {
                    link.click();
                }
            });
        } else if (window.location.pathname === "/") {
            $tabLinks.first().click();
        }
    }
};

Tabs.init();
