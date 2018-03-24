// Initialize Firebase
  var config = {
    apiKey: "AIzaSyDMYHVCZBMIioFSkJekODiR73YLBMAWkSA",
    authDomain: "tdc-2017-map.firebaseapp.com",
    databaseURL: "https://tdc-2017-map.firebaseio.com",
    projectId: "tdc-2017-map",
    storageBucket: "",
    messagingSenderId: "41083302772"
  };
  try {
    firebase.initializeApp(config);
    var database = firebase.database();

    firebase.auth().signInAnonymously().catch(function(error) {
      // Handle Errors here.
      var errorCode = error.code;
      var errorMessage = error.message;
      myViewModel.noSignInPopup();
      myViewModel.signinStatus('Sign-in error ' + errorCode + ': ' + errorMessage)
    });

    var favs; // To refer to favourites stored in the database

    firebase.auth().onAuthStateChanged(function(user) {
      if (user) {
        // User is signed in.
        myViewModel.signinStatus('Signed in as ' + (user.displayName ? user.displayName : 'user ' + user.uid));
        var uid = user.uid;
        favs = database.ref('users/' + uid + '/favs');
        // Update myViewModel.favourites() when 'database/users/ui/favs' changes
        favs.on('value', function(snapshot) {
          if (snapshot.val()) {
            myViewModel.favourites(Object.values(snapshot.val()));
            // Update array with IDs
            myViewModel.favIds([]);
            myViewModel.favourites().forEach(function(place) {
              myViewModel.favIds.push(place.place_id);
            });
          } else {
            myViewModel.favourites('');
            myViewModel.favIds('');
          }
        });
      } else {
        console.log('Signed out.');
      }
    });
  } catch(error) {
    myViewModel.noFirebasePopup();
    console.log(error);
  }

// Make "My location: Show/Hide" buttons a group, Hide disabled
$('#my-location-group').controlgroup({
  type: 'horizontal'
});
$('#my-location-hide').addClass('ui-state-disabled');

var map; // Has to be global to be used in ViewModel
var morePlaces = false; // A token for repeating search when boundaries change. The feature is currently commented out.

function initMap() {
  map = new google.maps.Map(document.getElementById('map'), {
    center: {lat: 63.436602, lng: 10.398891},
    zoom: 13,
    mapTypeControl: false,
    fullscreenControl: false
  });

  $.ajax({
    url: 'js/map-styles.js'
  }).done(function() {map.setOptions({styles: mapStyles})});

  // Side panel controls are hidden when the full-size Street View is active, so that they do not cover the SV controls.
  map.getStreetView().addListener('visible_changed', function() {
    if (map.getStreetView().getVisible()) {
      $('.panel-opener').css('display', 'none');
    } else $('.panel-opener').css('display', 'inline-block');
  });

  var iw = new google.maps.InfoWindow({}); // Only one window exists at a time
  var route = new google.maps.DirectionsRenderer({
    polylineOptions: {
      strokeColor: 'steelBlue'
    }
  });

  var makeInfoWindow = function(place) {
    var name = place.name ? place.name : '';
    var type = place.types ? place.types[0].replace(/_/g, ' ') : '';
    var address = place.formatted_address ? place.formatted_address : '';
    var notes = place.notes ? place.notes : '';
    iw.maxWidth = window.innerWidth;
    // Facebook like/share button in info window - only if the place has a website. Inner HTML of the FB plugin which is located in the end of the page body. 'data-href' is replaced by the website URL, the buttons are rebuilt and appended to the info window.
    var service = new google.maps.places.PlacesService(map);
    service.getDetails({placeId: place.place_id}, function(place, status) {
      if (status === google.maps.places.PlacesServiceStatus.OK && place.website) {
        console.log(place.website);
        $('#iw-facebook').attr('data-href', place.website);
        FB.XFBML.parse();
        $('.iw-pano-photos-share').append($('#iw-facebook').html());
      }
    });
    iw.setContent(
      '<article><h1 class=\"iw-place-name\">' + name + '</h1>' +
      '<h2 class=\"iw-place-type\"> &ndash; ' + type + '</h2>' +
      '<div class=\"iw-place-address\">' + address + '</div>' +
      '<div class=\"iw-pano-photos-share\">' +
      '<input id=\"iw-pano-photos-btn\" type=\"button\" value=\"Show photos\">' +
      '</div><div id=\"iw-panorama\"></div>' +
      '<div id=\"iw-notes\">' + notes + '</div>' +
      '<section class=\"iw-directions\"><input id=\"iw-directions-btn\" type=\"button\" value=\"Show directions\">' +
      '<label for=\"iw-directions-mode\">Travel mode:</label>' +
      '<select id=\"iw-directions-mode\">' +
      '<option value=\"WALKING\">Walking</option>' +
      '<option value=\"DRIVING\">Driving</option>' +
      '<option value=\"TRANSIT\">Transit</option>' +
      '<option value=\"BICYCLING\">Bicycling</option></select>' +
      '</section></article>'
    );
  };

  var activeMarker; // The only active marker with opacity == 1

  var makeMarker = function(place) {
    var icon = place.custom_icon;
    if (!place.custom_icon) {
      switch (place.types[0].toLowerCase()) {
        case 'venue':
          icon = 'img/meet.png';
          break;
        case 'cafe':
        case 'restaurant':
        case 'bakery':
          icon = 'img/cafe.png';
          break;
        case 'bar':
          icon = 'img/bar.png';
          break;
        case 'lodging':
          icon = 'img/hotel.png';
          break;
        case 'bus_station':
          icon = 'img/bus.png';
          break;
        case 'train_station':
          icon = 'img/train.png';
          break;
        default:
          icon = 'img/default.png';
      }
    }
    var marker = new google.maps.Marker({
      position: place.geometry.location,
      title: place.formatted_address,
      animation: google.maps.Animation.DROP,
      icon: icon,
      opacity: 0.7,
      pic: 'panorama',
      placeOnMap: place // For linking the list of places to markers
    });
    marker.onMap = ko.observable(); // For showing/hiding on the list

    window.addEventListener('click', function() {
      // Marker becomes 'inactive' whenever the info window is closed
      if (!iw.map) marker.setOpacity(0.7);
    });

    // Change marker's appearance on hover
    marker.addListener('mouseover', function() {
      marker.setAnimation(google.maps.Animation.BOUNCE);
    });
    marker.addListener('mouseout', function() {
      marker.setAnimation('none');
    });

    // StreetView in the info window
    var streetViewService = new google.maps.StreetViewService();
    var radius = 50;
    var panoOptions;
    function getStreetView(data, status) {
      if (status === google.maps.StreetViewStatus.OK) {
        var heading = google.maps.geometry.spherical.computeHeading(data.location.latLng, marker.position);
        panoOptions = {
          position: data.location.latLng,
          pov: {
            heading: heading,
            pitch: 0
          }
        };
        showPanorama(panoOptions, marker);
      } else document.getElementById('iw-panorama').appendChild(document.createTextNode('Cannot show panorama.'));
    }

    var showPanorama = function(panoOptions, marker) {
      $('#iw-panorama').empty();
      $('#iw-pano-photos-btn').attr('value', 'Show photos');
      marker.pic = 'panorama'; // Toggle panorama/photos indicator
      new google.maps.StreetViewPanorama(
        document.getElementById('iw-panorama'), panoOptions
      );
    };

    // Photos in the info window
    var showPhotos = function(marker) {
      $('#iw-panorama').empty();
      $('#iw-pano-photos-btn').attr('value', 'Show panorama');
      marker.pic = 'photos'; // Toggle panorama/photos indicator

      function displayPhoto(place, photoNum, photos) {
        $('.iw-photo-container').append('<img src=\"img/preloader.svg\" class=\"iw-preloader\">');
        var img = document.createElement('IMG');
        var imgUrl = photos[photoNum].getUrl({maxWidth: 800, maxHeight: 600});
        img.setAttribute('src', imgUrl);
        img.setAttribute('class', 'iw-photo');
        img.addEventListener('load', function(event) {
          $('.iw-photo-container').empty();
          $('.iw-photo-comment').append('<p>Photo ' +
          (photoNum + 1) + '\/' + photos.length +
          (photos.length > 1 ? ' - click or swipe to view next' : '' +
          '</p>'));
          $('.iw-photo-container').append(img);
        });
      }

      var service = new google.maps.places.PlacesService(map);
      service.getDetails({placeId: place.place_id}, getPhotos);
      function getPhotos(place, status) {
        if (status == google.maps.places.PlacesServiceStatus.OK) {
          var photos = place.photos;
          if (!photos) {
            $('#iw-panorama').append('<p>No photos found.</p>');
          } else {
            // Display the 1st photo
            var photoNum = 0;
            displayPhoto(place, photoNum, photos);
            $('#iw-panorama').append('<div class=\"iw-photo-comment\"></div>' + '<div class=\"iw-photo-container\"></div>');
            var nextPhoto = function() {
              // Update the photo and the count. After the last photo, start over.
              $('.iw-photo-container').empty();
              $('.iw-photo-comment').empty();
              photoNum = photoNum === photos.length - 1 ? 0 : photoNum + 1;
              displayPhoto(place, photoNum, photos);
            };
            var prevPhoto = function() {
              // Update the photo and the count. After the first photo, go to the last one.
              $('.iw-photo-container').empty();
              $('.iw-photo-comment').empty();
              photoNum = photoNum === 0 ? photos.length - 1 : photoNum - 1;
              displayPhoto(place, photoNum, photos);
            };
            $('.iw-photo-container').click(nextPhoto);
            $('.iw-photo-container').on('swipeleft', nextPhoto);
            $('.iw-photo-container').on('swiperight', prevPhoto);
          }
        } else {
          $('#iw-panorama').append('<p>Couldn\'t find photos.</p>');
        }
      }
    };

    // Add to / remove from favourites (Firebase)
    marker.addToFav = function(data, event) {
      // Some locations' properties (lat, lng) are functions which cannot be pushed to the database
      var latitude = typeof(data.placeOnMap.geometry.location.lat) === 'function' ? data.placeOnMap.geometry.location.lat() : data.placeOnMap.geometry.location.lat;
      var longitude = typeof(data.placeOnMap.geometry.location.lng) === 'function' ? data.placeOnMap.geometry.location.lng() : data.placeOnMap.geometry.location.lng;
      favs.push({
        name: data.placeOnMap.name,
        types: data.placeOnMap.types,
        formatted_address: data.placeOnMap.formatted_address,
        geometry: {location: {lat: latitude, lng: longitude}},
        place_id: data.placeOnMap.place_id
      });
    };

    marker.removeFromFav = function(data, event) {
      var placeID = data.placeOnMap.place_id;
      favs.once('value').then(function(snapshot) {
        snapshot.forEach(function(child) {
          if (child.val().place_id === placeID) {
            favs.ref.child(child.key).remove();
          }
        });
      });
    };

    // Show info window after a click on a marker
    marker.clickOnMarker = function() {
      if (activeMarker) activeMarker.setOpacity(0.7);
      activeMarker = marker;
      marker.setOpacity(1);
      makeInfoWindow(place);
      streetViewService.getPanoramaByLocation(marker.position, radius, getStreetView);
      iw.open(map, marker);

      // 'Show directions' button
      $('#iw-directions-btn').click(function() {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(function(position) {
            var origin = {
              lat: position.coords.latitude,
              lng: position.coords.longitude
            };
            var directionsService = new google.maps.DirectionsService();
            directionsService.route({
              origin: origin,
              destination: place.geometry.location,
              travelMode: $('#iw-directions-mode').val()
            }, function(response, status) {
              if (status === google.maps.DirectionsStatus.OK) {
                clearMap();
                route.setMap(map);
                route.setDirections(response);
                myViewModel.dirInstructions.removeAll();
                myViewModel.dirInstructionsHeader(
                  response.request.travelMode + ': ' +
                  response.routes[0].legs[0].distance.text + ', ' +
                  response.routes[0].legs[0].duration.text
                );
                myViewModel.dirInstructionsFrom(response.routes[0].legs[0].start_address);
                myViewModel.dirInstructionsTo(response.routes[0].legs[0].end_address);
                response.routes[0].legs[0].steps.forEach(function(step) {
                  myViewModel.dirInstructions.push(step.instructions);
                });
              }
            });
          }, geocoderError);
        } else {
          alert('Geolocation is not supported.');
        }
      });

      map.addListener('click', function() {
        iw.close();
      });
      $('#iw-pano-photos-btn').click(function() {
        if (marker.pic === 'panorama') {
          showPhotos(marker);
        } else showPanorama(panoOptions, marker);
      });

      // Update the weather forecast
      var geocoder = new google.maps.Geocoder();
      geocoder.geocode({location: marker.position}, function(result, status) {
        if (status === google.maps.GeocoderStatus.OK) {
          var country = '',
            countryLong = '',
            locality = '',
            postcode = '',
            request;
          result[0].address_components.forEach(function(component) {
            component.types.forEach(function(type) {
              if (type === 'country') {
                country = component.short_name;
                countryLong = component.long_name;
              }
              if (type === 'locality') locality = component.long_name;
              if (type === 'postal_code') postcode = component.long_name;
            });
          });
          if (country === 'NO') {
            // Weather request for Norway - by postal code
            postcode = parseInt(postcode, 10);
            request = 'https://www.yr.no/place/Norway/postnummer/' + postcode + '/forecast.xml';
            myViewModel.buildForecast(request);
          } else {
            // Request for other countries - by country and locality
            request = {};
            request.locality = locality;
            request.country = countryLong;
            request.url = 'https://www.yr.no/soek/soek.aspx?sted=' + locality + '&land=' + country + '&sok=Search';
            myViewModel.forecastFallback(request);
          }
        } else {myViewModel.forecastFallback({url: 'https://www.yr.no'})}
      });
    };

    marker.addListener('click', function() {this.clickOnMarker();});
    return marker;
  };

  // Show favourites
  $('#show-favourites').click(function() {
    if (myViewModel.favourites().length !== 0) {
      clearMap();
      showMarkers(myViewModel.favourites());
    } else {
      myViewModel.noFavs();
    }
  });

  var clearMap = function() {
    myViewModel.markersOnMap().forEach(function(marker) {
      marker.setMap(null);
      marker.onMap(false);
    });
    myViewModel.markersOnMap.removeAll();
    morePlaces = false;
    route.setMap(null);
    myViewModel.dirInstructions.removeAll();
    myViewModel.dirInstructionsHeader('');
    myViewModel.dirInstructionsFrom('');
    myViewModel.dirInstructionsTo('');
  };

  // Showing markers on map, adding them to ViewModel arrays for tracking
  var showMarkers = function(places) {
    var bounds = new google.maps.LatLngBounds();
    // If there are no markers to display, the map still covers the senter of Trondheim
    if (places.length === 0) {
      bounds.extend(myViewModel.confPlaces()[0].geometry.location);
      bounds.extend(myViewModel.confPlaces()[6].geometry.location);
    }
    places.forEach(function(place) {
      var marker = makeMarker(place);
      myViewModel.markersOnMap.push(marker);
      marker.setMap(map);
      marker.onMap(true);
      bounds.extend(marker.position);
    });
    map.fitBounds(bounds);
    if (places.length === 1) {
      map.setZoom(15);
    }
  };

  // Showing initial markers on the map
  showMarkers(myViewModel.confPlaces());

  $('#show-conf').click(function() {
    clearMap();
    showMarkers(myViewModel.confPlaces());
  });
  $('#clear-map-btn').click(clearMap);

  // Find more places
  var mapBounds;
  // The user will have to repeat search every time the map is zoomed or panned. The way Search Box handles bounds is too unpredictable for automatic search. Uncomment the line below to check its behaviour.
  map.addListener('bounds_changed', function() {
    mapBounds = map.getBounds();
    // if (morePlaces) findMorePlaces();
  });
  var findMorePlaces = function() {
    clearMap();
    morePlaces = true;
    searchBox.setBounds(mapBounds);
    var places = searchBox.getPlaces();
    var filteredPlaces = []; // No places outside bounds should be displayed
    places.forEach(function(place) {
      if (mapBounds.contains(place.geometry.location)) {
        filteredPlaces.push(place);
      }
    });
    showMarkers(filteredPlaces);
  };
  var placeInput = document.getElementById('find-more-places');
  var searchBox = new google.maps.places.SearchBox(placeInput);
  $('#find-more-places').click(function() {
    mapBounds = map.getBounds();
    searchBox.setBounds(mapBounds);
  });
  searchBox.addListener('places_changed', findMorePlaces);

  // My position: 'Show my location' button and directions
  function geocoderError(error) {
    var errorText;
    switch (error.code) {
      case error.PERMISSION_DENIED:
      errorText = 'Access denied.';
      break;
      case error.POSITION_UNAVAILABLE:
      errorText = 'Location info unavailable.';
      break;
      case error.TIMEOUT:
      errorText = 'Request timed out.';
      break;
      default:
      errorText = 'Unknown error.';
    }
    alert(errorText);
  }
  var myPosition,
    currentPlace,
    markerCurrentPlace = new google.maps.Marker();
  $('#my-location-show').click(function() {
    markerCurrentPlace.setMap(null);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(function(position) {
        myPosition = position;
        var myLocation = {
          lat: myPosition.coords.latitude,
          lng: myPosition.coords.longitude
        };
        currentPlace = {
          name: 'My position',
          types: ['i_am_here_now'],
          geometry: {location: myLocation},
          custom_icon: 'img/my-position.png',
          place_id: '',
          formatted_address: ''
        };
        var geocoder = new google.maps.Geocoder();
        geocoder.geocode({location: myLocation}, function(results, status) {
          if (status === google.maps.GeocoderStatus.OK) {
            if (results[0]) {
              currentPlace.formatted_address = results[0].formatted_address;
              currentPlace.place_id = results[0].place_id;
            }
          } else currentPlace[0].formatted_address = 'No address found.';
        });
        // The marker is displayed separately, it's not in the list and clearMap() does not affect it.
        markerCurrentPlace = makeMarker(currentPlace);
        markerCurrentPlace.setMap(map);
        map.setCenter(markerCurrentPlace.getPosition());
        map.setZoom(15);
        $('#my-location-hide').removeClass('ui-state-disabled');
        $('#my-location-hide').click(function() {
          markerCurrentPlace.setMap(null);
          $('#my-location-hide').addClass('ui-state-disabled');
        });
      }, geocoderError);
    } else {
      // If geolocation isn't supported, the position of the sentral station is used as a default location and the user is alerted
      myPosition = myViewModel.confPlaces()[1].geometry.location;
      alert('Geolocation is not supported.');
    }
  });
}
